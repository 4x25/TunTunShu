// 参考库排名、置信度校准与序列形态检查。
// Ported from Ikaleio/lm-detector (MIT); original: shared/shared-detector.ts.
//
// 重要:结果是参考库内的闭集排序。库外模型也会得到“最接近”的候选,
// 排名/置信度不是模型身份证明。

import {
  countNumbers,
  hellingerFeature,
  orderedBlockFeature,
  parseNumbers,
} from "./core.ts";
import { positionalDecision } from "./positional.ts";
import type {
  Analysis,
  AnalysisCandidate,
  AnalysisDiagnostic,
  AnalysisSequence,
  FingerprintBank,
  Matrix,
  Output,
  Preprocessing,
  SharedDetector,
  Vector,
} from "./types.ts";

const dot = (a: Vector, b: Vector) =>
  a.reduce((sum, x, i) => sum + x * b[i], 0);
const mean = (a: Vector) => a.reduce((sum, x) => sum + x, 0) / a.length;
const norm = (a: Vector) => {
  const n = Math.max(Math.sqrt(dot(a, a)), 1e-12);
  return a.map((x) => x / n);
};
const z = (a: Vector) => {
  const m = mean(a);
  const s = Math.max(
    Math.sqrt(mean(a.map((x) => (x - m) ** 2))),
    1e-12,
  );
  return a.map((x) => (x - m) / s);
};
const columnMean = (a: Matrix) => a[0].map((_, i) => mean(a.map((r) => r[i])));
const median = (a: Vector) => {
  const v = [...a].sort((x, y) => x - y);
  const i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
};
const blocks = (n: Vector): Matrix => [
  hellingerFeature(countNumbers(n)),
  orderedBlockFeature(n),
];
const transform = (b: Matrix, p: Preprocessing): Vector =>
  b.flatMap((v, j) =>
    norm(v.map((x, i) => (x - p[j].mean[i]) / p[j].scale[i])).map((x) =>
      x * Math.sqrt(j === 0 ? 0.75 : 0.25)
    )
  );
const centered = (
  v: Vector,
  p: SharedDetector["ranker"]["bank"]["hellinger"],
) => v.map((x, i) => (x - p.feature_mean[i]) / p.feature_scale[i]);
const subtract = (v: Vector, b: Matrix) => {
  const coefficients = b.map((row) => dot(v, row));
  return v.map((x, i) =>
    x - b.reduce((sum, row, j) => sum + coefficients[j] * row[i], 0)
  );
};
const referenceNorms = new WeakMap<Matrix, Vector>();
function nearest(x: Vector, references: Matrix): number {
  let norms = referenceNorms.get(references);
  if (!norms) {
    norms = references.map((r) => dot(r, r));
    referenceNorms.set(references, norms);
  }
  const xx = dot(x, x);
  return mean(
    references
      .map((r, i) => Math.max(0, xx + norms![i] - 2 * dot(x, r)))
      .sort((a, b) => a - b)
      .slice(0, 7),
  );
}
function baseline(
  b: Matrix,
  bank: SharedDetector["ranker"]["bank"],
): Vector {
  const h = bank.hellinger, o = bank.ordered_blocks;
  const hUnit = norm(subtract(centered(b[0], h), h.nuisance_basis));
  const marginal = h.centroids.map((row) => dot(hUnit, row));
  const oCentered = centered(b[1], o), raw = norm(oCentered);
  const projected = norm(subtract(oCentered, o.nuisance_basis));
  const templates = o.centroids.map((_, i) =>
    Math.max(...o.environment_centroids.map((rows) => dot(raw, rows[i])))
  );
  const nuisance = o.centroids.map((row) => dot(projected, row));
  const tz = z(templates), nz = z(nuisance);
  const ordered = z(tz.map((v, i) => 0.5 * v + 0.5 * nz[i]));
  const mz = z(marginal);
  return mz.map((v, i) => 0.5 * v + 0.5 * ordered[i]);
}

/** bank 元数据必须与检测器来自同一次训练快照。 */
export function supportsDetector(
  bank: FingerprintBank,
  artifact: SharedDetector,
): boolean {
  return artifact.schema === "shared-detector-v2" &&
    bank.built_at === artifact.bank_built_at &&
    bank.models.length === artifact.model_ids.length &&
    bank.models.every((m, i) =>
      m.id === artifact.model_ids[i] &&
      m.response_count === artifact.response_counts[i]
    );
}

/** 与排名绑定的温度 softmax;校准参数不匹配时返回 null。 */
export function calibrateRanking(
  ranking: Vector,
  artifact: SharedDetector,
): Vector | null {
  const head = artifact.calibration, binding = head?.binding;
  if (
    !head || !binding || head.schema !== "shared-confidence-v2" ||
    head.method !== "ranking-temperature" ||
    !Number.isFinite(head.tau) || head.tau < 0.001 || head.tau > 1000 ||
    binding.base_sha256 !== artifact.base_sha256 ||
    binding.reference_sha256 !== artifact.source_reference_sha256 ||
    binding.model_ids.length !== ranking.length ||
    ranking.length !== artifact.model_ids.length ||
    !ranking.every(Number.isFinite) ||
    !binding.model_ids.every((id, i) => id === artifact.model_ids[i])
  ) return null;
  const logits = ranking.map((score) => head.tau * score);
  const maximum = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - maximum));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((value) => value / sum);
}

function rankSharedNumbers(
  numbers: Matrix,
  artifact: SharedDetector,
): Vector {
  const a = artifact.ranker, full = numbers.map(blocks);
  const ax = full.map((b) => transform(b, a.full_params));
  const lda = numbers.map((n) => {
    const x = transform(blocks(n.slice(0, 128)), a.head_params);
    return z(
      a.lda_weights.map((row, i) => dot(row, x) + a.lda_bias[i]),
    );
  });
  const l = z(columnMean(lda));
  const near = z(
    a.references.map((ref) => median(ax.map((x) => -nearest(x, ref)))),
  );
  const base = z(columnMean(full.map((b) => baseline(b, a.bank))));
  const frequency = z(
    l.map((x, i) => 0.5 * x + 0.25 * near[i] + 0.25 * base[i]),
  );
  const positional = z(
    columnMean(numbers.map((n) => z(positionalDecision(n, a.positional)))),
  );
  const ranking = frequency.map((x, i) =>
    a.blend.frequency * x + a.blend.positional * positional[i]
  );
  if (!ranking.every(Number.isFinite)) {
    throw new Error("排名计算产生无效数值，请重试");
  }
  return ranking;
}

const SEQUENCE_LIMITS = { autocorrelation: -0.23, small_step_share: 0.05 };

function sequenceShape(numbers: Matrix): AnalysisSequence {
  const shapes = numbers.map((n) => {
    const m = mean(n);
    const variance = mean(n.map((x) => (x - m) ** 2));
    const steps = n.slice(1).map((x, i) => x - n[i]);
    return {
      autocorrelation: variance
        ? mean(steps.map((_, i) => (n[i + 1] - m) * (n[i] - m))) / variance
        : 1,
      small_step_share: mean(steps.map((d) => Math.abs(d) <= 20 ? 1 : 0)),
    };
  });
  const autocorrelation = median(shapes.map((s) => s.autocorrelation));
  const small_step_share = median(shapes.map((s) => s.small_step_share));
  return {
    autocorrelation,
    small_step_share,
    model_like: autocorrelation <= SEQUENCE_LIMITS.autocorrelation &&
      small_step_share <= SEQUENCE_LIMITS.small_step_share,
  };
}

function commonAnalysis(
  used: number,
  diagnostics: AnalysisDiagnostic[],
  sequence: AnalysisSequence | null,
  artifact: SharedDetector,
): Analysis {
  return {
    prediction: "",
    prediction_name: "",
    probability: null,
    probability_status: "unavailable",
    used_outputs: used,
    results: [],
    diagnostics,
    sequence,
    family_prediction_name: "",
    evidence: {
      insufficient: true,
      label: "",
      reason: "",
      threshold: null,
      method: "",
    },
    method: "shared-detector-v2",
    model_version: { base_sha256: artifact.base_sha256 },
  };
}

function candidateResults(
  order: number[],
  ranking: Vector,
  probabilities: Vector | null,
  bank: FingerprintBank,
): AnalysisCandidate[] {
  return order.map((i) => ({
    model: bank.models[i].id,
    display_name: bank.models[i].display_name,
    family: bank.models[i].family,
    family_name: bank.models[i].family_name,
    score: ranking[i],
    probability: probabilities?.[i] ?? null,
  }));
}

/**
 * 对 3 条采样做数字指纹分析。
 * `allowPartial` 为 true 时,1–2 条有效回答也会给出排名(但没有置信度)。
 */
export function analyzeFingerprint(
  outputs: Output[],
  bank: FingerprintBank,
  artifact: SharedDetector,
  options: { allowPartial?: boolean } = {},
): Analysis {
  if (!supportsDetector(bank, artifact)) {
    throw new Error("指纹参考库与检测器不匹配，请重新同步 data/fingerprint");
  }
  const parsed = outputs.map((o) => parseNumbers(o.text));
  const diagnostics = outputs.map((o, index): AnalysisDiagnostic => {
    const minimum = Math.max(80, Math.ceil((o.expected_count || 0) * 0.55));
    const raw = Array.from(o.text.matchAll(/-?\d+/g), (m) => Number(m[0]));
    return {
      index,
      parsed_numbers: parsed[index].length,
      minimum_numbers: minimum,
      accepted: parsed[index].length >= minimum,
      raw_out_of_range_count: raw.filter((n) => n < 1 || n > 355).length,
    };
  });
  const used = diagnostics.filter((d) => d.accepted).length;
  const accepted = parsed.filter((_, i) => diagnostics[i].accepted);
  const sequence = used ? sequenceShape(accepted) : null;
  const common = commonAnalysis(used, diagnostics, sequence, artifact);

  const notModel: Analysis = {
    ...common,
    prediction_name: "不像语言模型回答",
    decision: "not_model",
    evidence: {
      insufficient: true,
      label: "不像语言模型回答",
      reason:
        "相邻数字的变化方式与参考库中的语言模型回答不同，常见于程序生成、排序或打乱顺序的数字。未生成排名。",
      threshold: null,
      method: "sequence-shape",
    },
  };

  if (options.allowPartial && used > 0 && used < 3 && outputs.length <= 3) {
    if (!sequence!.model_like) return notModel;
    const ranking = rankSharedNumbers(accepted, artifact);
    const order = artifact.model_ids.map((_, i) => i).sort((i, j) =>
      ranking[j] - ranking[i]
    );
    const results = candidateResults(order, ranking, null, bank);
    const first = order[0];
    return {
      ...common,
      method: "shared-ranker-partial-v1",
      decision: "partial",
      prediction: results[0].model,
      prediction_name: results[0].display_name,
      family_prediction_name: bank.models[first].family_name,
      results,
      ranking_score: ranking[first],
      evidence: {
        insufficient: true,
        label: "部分样本排名",
        reason:
          `使用 ${used}/3 条有效回答生成排名。重新验证并取得三条有效回答后才能计算置信度。`,
        threshold: null,
        method: "partial-sample-ranking",
      },
    };
  }

  if (outputs.length !== 3 || used !== 3) {
    return {
      ...common,
      prediction_name: "暂不可评分",
      decision: "unscorable",
      evidence: {
        insufficient: true,
        label: "需要三条完整回答",
        reason: `当前有 ${used}/${outputs.length} 条有效回答，请重新验证。`,
        threshold: null,
        method: "complete-three-answers",
      },
    };
  }

  if (!sequence!.model_like) return notModel;

  const ranking = rankSharedNumbers(parsed, artifact);
  const probabilities = calibrateRanking(ranking, artifact);
  const order = artifact.model_ids.map((_, i) => i).sort((i, j) =>
    ranking[j] - ranking[i]
  );
  const results = candidateResults(order, ranking, probabilities, bank);
  const first = order[0];
  return {
    ...common,
    decision: "prediction",
    prediction: results[0].model,
    prediction_name: results[0].display_name,
    family_prediction_name: bank.models[first].family_name,
    results,
    ranking_score: ranking[first],
    probability: results[0].probability,
    probability_status: probabilities ? "reference_calibrated" : "unavailable",
    probability_scope: probabilities ? "reference-closed-set" : null,
    calibration: probabilities
      ? {
        method: artifact.calibration!.method,
        run: artifact.calibration!.calibration_run,
        tau: artifact.calibration!.tau,
        sha256: artifact.calibration_sha256 ?? null,
      }
      : null,
    evidence: {
      insufficient: true,
      label: probabilities ? "库内校准排名" : "未校准排名",
      reason: probabilities
        ? "置信度是参考库内的闭集相对概率，不包含库外模型。"
        : "校准参数与当前检测器不匹配，置信度不可用。候选顺序由排名分数决定。",
      threshold: null,
      method: probabilities
        ? "reference-calibrated-ranking"
        : "uncalibrated-ranking",
    },
  };
}
