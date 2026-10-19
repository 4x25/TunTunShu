// 上游模型指纹验证。
//
// 让模型按 3 个随机挑战各写 292–332 个 1–355 的整数,解析数字后用随仓库发布的
// 参考库做闭集排名。算法/数据来自 Ikaleio/lm-detector(MIT),见 lib/fingerprint/。
//
// 结果只是“参考库内最接近的候选”,不是模型身份证明;库外模型也会得到候选。

import { generateText, streamText } from "ai";
import { getSql } from "../db/client.ts";
import { analyzeFingerprint } from "../lib/fingerprint/analyze.ts";
import { generateChallenges } from "../lib/fingerprint/challenges.ts";
import { parseNumbers } from "../lib/fingerprint/core.ts";
import {
  finishReasonError,
  inspectSample,
  redactSecret,
  type SampleInspection,
} from "../lib/fingerprint/sample.ts";
import { loadFingerprintData } from "../lib/fingerprint/data.ts";
import type {
  Analysis,
  Challenge,
  FingerprintBank,
} from "../lib/fingerprint/types.ts";
import type { EndpointType } from "../types/enums.ts";
import {
  buildModel,
  describeError,
  resolveUpstreamTimeoutMs,
} from "./upstream_model_test_service.ts";

/** 指纹采样比单次对话大得多,给一个不低于 120s 的下限。 */
const MIN_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 8192;
/** 防止模型输出异常长文本拖垮边缘实例。 */
const MAX_SAMPLE_CHARS = 200_000;
/** 返回给浏览器的单条采样原文上限。 */
const MAX_RETURNED_SAMPLE_CHARS = 8_000;
const RETURNED_CANDIDATES = 10;

type Model = ReturnType<typeof buildModel>;

interface Target {
  upstreamName: string;
  endpointType: EndpointType;
  apiKey: string;
  origin: string;
  mappedModel: string | null;
}

interface RawSample {
  text: string;
  capped: boolean;
  latencyMs: number;
  error?: string;
}

interface EvaluatedSample extends SampleInspection {
  index: number;
  expectedCount: number;
  latencyMs: number;
  text: string;
  error?: string;
}

export interface FingerprintSampleResult {
  index: number;
  expectedCount: number;
  parsedNumbers: number;
  usedNumbers: number;
  minimumNumbers: number;
  accepted: boolean;
  rawOutOfRangeCount: number;
  anomalous: boolean;
  capped: boolean;
  latencyMs: number;
  text: string;
  error?: string;
}

export interface FingerprintCandidateResult {
  model: string;
  displayName: string;
  family: string;
  familyName: string;
  probability: number | null;
  score: number;
}

export interface FingerprintResult {
  claimedModel: string;
  mappedModel: string | null;
  endpointType: EndpointType;
  decision: "prediction" | "partial" | "not_model" | "unscorable";
  prediction: string;
  predictionName: string;
  familyName: string;
  probability: number | null;
  rankingScore: number | null;
  usedOutputs: number;
  results: FingerprintCandidateResult[];
  samples: FingerprintSampleResult[];
  sequence: {
    autocorrelation: number;
    smallStepShare: number;
    modelLike: boolean;
  } | null;
  evidence: { label: string; reason: string };
  bankBuiltAt: string;
  bankModelCount: number;
  latencyMs: number;
  error?: string;
}

async function loadTarget(id: number): Promise<Target | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const sql = getSql();
  const rows = await sql<{
    upstream_name: string;
    endpoint_type: EndpointType;
    api_key: string;
    origin: string;
    mapped_model: string | null;
  }[]>`
    select upstream_models.name as upstream_name,
           upstream_models.endpoint_type,
           api_keys.key as api_key,
           sites.origin,
           models.name as mapped_model
    from upstream_models
    join api_keys on api_keys.id = upstream_models.api_key_id
    join accounts on accounts.id = api_keys.account_id
    join sites    on sites.id    = accounts.site_id
    left join models on models.id = upstream_models.model_id
    where upstream_models.id = ${id}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    upstreamName: row.upstream_name,
    endpointType: row.endpoint_type,
    apiKey: row.api_key,
    origin: row.origin,
    mappedModel: row.mapped_model,
  };
}

function errorText(error: unknown, secret: string): string {
  const { message } = describeError(error);
  return redactSecret(message, secret);
}

/**
 * 流式采样;收到足够多的完整整数后主动 abort,避免模型继续生成或长时间等待。
 * 若流式在收到任何文本前失败,回退一次非流式请求(兼容不支持 SSE 的上游)。
 */
async function sampleWithStream(
  model: Model,
  challenge: Challenge,
  timeoutMs: number,
  apiKey: string,
): Promise<RawSample> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let capped = false;
  let tooLong = false;
  let text = "";
  let streamError: string | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const result = streamText({
      model,
      messages: [{ role: "user", content: challenge.prompt }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: controller.signal,
      onError: ({ error }) => {
        streamError = errorText(error, apiKey);
      },
    });
    let checkedAt = 0;
    try {
      for await (const delta of result.textStream) {
        text += delta;
        if (text.length > MAX_SAMPLE_CHARS) {
          tooLong = true;
          controller.abort();
          break;
        }
        if (text.length - checkedAt < 256) continue;
        checkedAt = text.length;
        if (
          parseNumbers(text.replace(/\d+$/, "")).length >=
            challenge.expected_count
        ) {
          capped = true;
          controller.abort();
          break;
        }
      }
    } finally {
      // 主动 abort 后不再关心完整文本/usage promise 的结果。
      void Promise.resolve(result.text).catch(() => {});
    }
    let finishError: string | undefined;
    if (!capped && !tooLong && !timedOut) {
      try {
        finishError = finishReasonError(
          await Promise.resolve(result.finishReason),
        );
      } catch (error) {
        finishError = errorText(error, apiKey) || "流式输出未完整结束";
      }
    }
    if (!capped && !tooLong && !timedOut && !finishError && streamError) {
      finishError = streamError;
    }
    if (timedOut) finishError = "请求超时";
    if (
      !timedOut && !capped && !tooLong && finishError && text.length === 0
    ) {
      clearTimeout(timer);
      return await sampleWithoutStream(
        model,
        challenge,
        Math.max(1_000, startedAt + timeoutMs - Date.now()),
        apiKey,
        finishError,
        startedAt,
      );
    }
    return {
      text,
      capped,
      latencyMs: Date.now() - startedAt,
      error: tooLong ? "输出过长" : finishError,
    };
  } catch (error) {
    clearTimeout(timer);
    if (tooLong) {
      return {
        text,
        capped,
        latencyMs: Date.now() - startedAt,
        error: "输出过长",
      };
    }
    if (capped) {
      return { text, capped, latencyMs: Date.now() - startedAt };
    }
    if (timedOut) {
      return {
        text,
        capped,
        latencyMs: Date.now() - startedAt,
        error: "请求超时",
      };
    }
    const message = errorText(error, apiKey);
    if (text.length > 0) {
      return {
        text,
        capped,
        latencyMs: Date.now() - startedAt,
        error: message,
      };
    }
    return await sampleWithoutStream(
      model,
      challenge,
      Math.max(1_000, startedAt + timeoutMs - Date.now()),
      apiKey,
      message,
      startedAt,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function sampleWithoutStream(
  model: Model,
  challenge: Challenge,
  remainingMs: number,
  apiKey: string,
  streamError: string,
  startedAt: number,
): Promise<RawSample> {
  try {
    const result = await generateText({
      model,
      messages: [{ role: "user", content: challenge.prompt }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(remainingMs),
    });
    const text = result.text ?? "";
    const tooLong = text.length > MAX_SAMPLE_CHARS;
    return {
      text: text.slice(0, MAX_SAMPLE_CHARS),
      capped: false,
      latencyMs: Date.now() - startedAt,
      error: tooLong ? "输出过长" : finishReasonError(result.finishReason),
    };
  } catch (error) {
    const message = errorText(error, apiKey);
    return {
      text: "",
      capped: false,
      latencyMs: Date.now() - startedAt,
      error: streamError && streamError !== message
        ? `流式失败：${streamError}；非流式失败：${message}`
        : message,
    };
  }
}

function evaluateSample(
  index: number,
  challenge: Challenge,
  sample: RawSample,
  apiKey: string,
): EvaluatedSample {
  return {
    index,
    expectedCount: challenge.expected_count,
    ...inspectSample(sample.text, challenge.expected_count, {
      error: sample.error,
      capped: sample.capped,
    }),
    latencyMs: sample.latencyMs,
    text: redactSecret(sample.text, apiKey).slice(
      0,
      MAX_RETURNED_SAMPLE_CHARS,
    ),
    error: sample.error ? redactSecret(sample.error, apiKey) : undefined,
  };
}

function emptyResult(
  target: Target,
  latencyMs: number,
  error: string,
): FingerprintResult {
  return {
    claimedModel: target.upstreamName,
    mappedModel: target.mappedModel,
    endpointType: target.endpointType,
    decision: "unscorable",
    prediction: "",
    predictionName: "指纹验证失败",
    familyName: "",
    probability: null,
    rankingScore: null,
    usedOutputs: 0,
    results: [],
    samples: [],
    sequence: null,
    evidence: { label: "请求失败", reason: error },
    bankBuiltAt: "",
    bankModelCount: 0,
    latencyMs,
    error,
  };
}

function toResult(
  analysis: Analysis,
  bank: FingerprintBank,
  target: Target,
  samples: EvaluatedSample[],
  latencyMs: number,
): FingerprintResult {
  const decision = analysis.decision ??
    (analysis.prediction ? "prediction" : "unscorable");
  const firstError = samples.find((sample) => sample.error)?.error;
  return {
    claimedModel: target.upstreamName,
    mappedModel: target.mappedModel,
    endpointType: target.endpointType,
    decision,
    prediction: analysis.prediction,
    predictionName: analysis.prediction_name,
    familyName: analysis.family_prediction_name,
    probability: analysis.probability,
    rankingScore: analysis.ranking_score ?? null,
    usedOutputs: analysis.used_outputs,
    results: analysis.results.slice(0, RETURNED_CANDIDATES).map((
      candidate,
    ) => ({
      model: candidate.model,
      displayName: candidate.display_name,
      family: candidate.family,
      familyName: candidate.family_name,
      probability: candidate.probability,
      score: candidate.score,
    })),
    samples: samples.map((sample) => ({
      index: sample.index,
      expectedCount: sample.expectedCount,
      parsedNumbers: sample.parsedNumbers,
      usedNumbers: sample.usedNumbers,
      minimumNumbers: sample.minimumNumbers,
      accepted: sample.accepted,
      rawOutOfRangeCount: sample.rawOutOfRangeCount,
      anomalous: sample.anomalous,
      capped: sample.capped,
      latencyMs: sample.latencyMs,
      text: sample.text,
      error: sample.error,
    })),
    sequence: analysis.sequence
      ? {
        autocorrelation: analysis.sequence.autocorrelation,
        smallStepShare: analysis.sequence.small_step_share,
        modelLike: analysis.sequence.model_like,
      }
      : null,
    evidence: {
      label: analysis.evidence.label,
      reason: analysis.evidence.reason,
    },
    bankBuiltAt: bank.built_at,
    bankModelCount: bank.models.length,
    latencyMs,
    error: analysis.used_outputs === 0 && firstError ? firstError : undefined,
  };
}

/**
 * 对某个上游模型执行一次指纹验证;模型不存在时返回 null。
 * 上游请求失败会体现在每条采样诊断里,而不是抛出异常。
 */
export async function fingerprintUpstreamModel(
  id: number,
): Promise<FingerprintResult | null> {
  const target = await loadTarget(id);
  if (!target) return null;

  const startedAt = Date.now();
  const { bank, detector } = await loadFingerprintData();
  const challenges = generateChallenges(3);
  const timeoutMs = Math.max(await resolveUpstreamTimeoutMs(), MIN_TIMEOUT_MS);

  let model: Model;
  try {
    model = buildModel(
      target.endpointType,
      target.origin,
      target.apiKey,
      target.upstreamName,
    );
  } catch (error) {
    return emptyResult(
      target,
      Date.now() - startedAt,
      errorText(error, target.apiKey),
    );
  }

  const settled = await Promise.allSettled(
    challenges.map((challenge) =>
      sampleWithStream(model, challenge, timeoutMs, target.apiKey)
    ),
  );
  const samples = challenges.map((challenge, index) => {
    const result = settled[index];
    const raw: RawSample = result.status === "fulfilled" ? result.value : {
      text: "",
      capped: false,
      latencyMs: 0,
      error: errorText(result.reason, target.apiKey),
    };
    return evaluateSample(index, challenge, raw, target.apiKey);
  });

  const outputs = samples.map((sample) => ({
    text: sample.accepted ? sample.normalizedText : "",
    expected_count: sample.expectedCount,
  }));
  const analysis = analyzeFingerprint(outputs, bank, detector, {
    allowPartial: true,
  });
  return toResult(
    analysis,
    bank,
    target,
    samples,
    Date.now() - startedAt,
  );
}
