import { define } from "../../../utils.ts";
import { NewApiAdapter } from "../../../adapters/new_api_adapter.ts";
import { getSql } from "../../../db/client.ts";
import { defaultSettings } from "../../../lib/config.ts";
import { getAuthKey } from "../../../lib/env.ts";
import { maskKey } from "../../../lib/mask.ts";
import { openaiError } from "../../../lib/response.ts";
import { createUsageSniffingStream } from "../../../lib/sse.ts";
import type { ChatCompletionRequest, Usage } from "../../../types/openai.ts";

const adapter = new NewApiAdapter();

interface RoutableModel {
  upstream_model_id: number;
  upstream_name: string;
  api_key: string;
  origin: string;
}

interface LogBase {
  requestIp: string | null;
  requestPath: string;
  requestKey: string | null;
  requestModel: string;
}

function splitKeys(value: string | null): string[] {
  return (value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(
    Boolean,
  );
}

function extractBearer(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice(7).trim() || null;
}

async function getSetting(key: keyof typeof defaultSettings): Promise<string> {
  const sql = getSql();
  const rows = await sql<{ value: string }[]>`
    select value from system_settings where key = ${key} limit 1
  `;
  return rows[0]?.value ?? defaultSettings[key];
}

async function getSettingNumber(
  key: keyof typeof defaultSettings,
): Promise<number> {
  const value = Number(await getSetting(key));
  return Number.isFinite(value) ? value : Number(defaultSettings[key]);
}

async function getProxyKeys(): Promise<string[]> {
  return Array.from(
    new Set([getAuthKey(), ...splitKeys(await getSetting("proxy_auth_keys"))]),
  );
}

async function findRoutableModels(modelName: string): Promise<RoutableModel[]> {
  const sql = getSql();
  return await sql<RoutableModel[]>`
    select
      upstream_models.id as upstream_model_id,
      upstream_models.name as upstream_name,
      api_keys.key as api_key,
      sites.origin as origin
    from models
    join upstream_models on upstream_models.model_id = models.id
    join api_keys on api_keys.id = upstream_models.api_key_id
    join accounts on accounts.id = api_keys.account_id
    join sites on sites.id = accounts.site_id
    where models.name = ${modelName}
      and models.enabled = true
      and upstream_models.enabled = true
      and upstream_models.status <> 'invalid'
      and api_keys.enabled = true
      and api_keys.status <> 'invalid'
      and accounts.enabled = true
      and accounts.status <> 'invalid'
      and sites.enabled = true
      and sites.status <> 'down'
  `;
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function logBase(candidate: RoutableModel, base: LogBase) {
  return {
    requestIp: base.requestIp,
    requestPath: base.requestPath,
    requestKey: base.requestKey,
    requestModel: base.requestModel,
    upstreamUrl: `${candidate.origin}/v1/chat/completions`,
    upstreamKey: maskKey(candidate.api_key),
    upstreamModel: candidate.upstream_name,
    upstreamModelId: candidate.upstream_model_id,
  };
}

/** 改写 model 名;客户端未显式设置 stream_options 时注入 include_usage 以统计 token。 */
function buildUpstreamBody(
  body: ChatCompletionRequest,
  upstreamModel: string,
): ChatCompletionRequest {
  const out: ChatCompletionRequest = { ...body, model: upstreamModel };
  if (out.stream === true && out.stream_options == null) {
    out.stream_options = { include_usage: true };
  }
  return out;
}

function parseUsage(text: string): Usage | null {
  try {
    const obj = JSON.parse(text) as { usage?: Partial<Usage> | null };
    if (obj?.usage && typeof obj.usage.total_tokens === "number") {
      return obj.usage as Usage;
    }
  } catch {
    // 声称成功却非 JSON → usage 留 null
  }
  return null;
}

async function writeRequestLog(input: {
  status: "success" | "failed";
  requestType: "final" | "retry";
  httpStatus: number | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  requestIp: string | null;
  requestPath: string;
  requestKey: string | null;
  requestModel: string;
  upstreamUrl: string | null;
  upstreamKey: string | null;
  upstreamModel: string | null;
  upstreamModelId: number | null;
  errorMessage: string | null;
}) {
  const sql = getSql();
  await sql`
    insert into request_logs (
      status, request_type, http_status,
      prompt_tokens, completion_tokens, total_tokens,
      latency_ms, request_ip, request_path,
      request_key, request_model, upstream_url, upstream_key, upstream_model,
      upstream_model_id, error_message
    ) values (
      ${input.status}, ${input.requestType}, ${input.httpStatus},
      ${input.promptTokens}, ${input.completionTokens}, ${input.totalTokens},
      ${input.latencyMs}, ${input.requestIp}, ${input.requestPath},
      ${input.requestKey}, ${input.requestModel}, ${input.upstreamUrl}, ${input.upstreamKey}, ${input.upstreamModel},
      ${input.upstreamModelId}, ${input.errorMessage}
    )
  `;
}

export const handler = define.handlers({
  async POST(ctx) {
    const token = extractBearer(ctx.req);
    if (!token || !(await getProxyKeys()).includes(token)) {
      return openaiError("Invalid authentication credentials", {
        status: 401,
        code: "invalid_api_key",
      });
    }

    const body = await ctx.req.json().catch(() => null) as
      | ChatCompletionRequest
      | null;
    if (!body?.model) {
      return openaiError("Invalid request body: 'model' is required", {
        status: 400,
        param: "model",
      });
    }

    const candidates = shuffle(await findRoutableModels(body.model));
    if (!candidates.length) {
      return openaiError(
        `The model '${body.model}' does not exist or is not available`,
        { status: 404, code: "model_not_found", param: "model" },
      );
    }

    const retryCount = Math.max(
      0,
      await getSettingNumber("channel_retry_count"),
    );
    const timeoutMs =
      Math.max(1, await getSettingNumber("upstream_header_timeout_seconds")) *
      1000;
    const attempts = candidates.slice(
      0,
      Math.min(candidates.length, retryCount + 1),
    );
    const base: LogBase = {
      requestIp:
        ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      requestPath: new URL(ctx.req.url).pathname,
      requestKey: maskKey(token),
      requestModel: body.model,
    };
    const isStream = body.stream === true;

    let lastError: string | null = null;
    let lastErrorResponse:
      | { status: number; body: string; contentType: string }
      | null = null;

    for (const [index, candidate] of attempts.entries()) {
      const isFinal = index === attempts.length - 1;
      const startedAt = Date.now();
      const abortController = new AbortController();
      const headerTimer = setTimeout(() => abortController.abort(), timeoutMs);

      let response: Response;
      try {
        response = await adapter.chatCompletions(
          { origin: candidate.origin, apiKey: candidate.api_key },
          buildUpstreamBody(body, candidate.upstream_name),
          abortController.signal,
        );
      } catch (error) {
        clearTimeout(headerTimer);
        lastError = error instanceof Error ? error.message : String(error);
        await writeRequestLog({
          status: "failed",
          requestType: isFinal ? "final" : "retry",
          httpStatus: null,
          latencyMs: Date.now() - startedAt,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          ...logBase(candidate, base),
          errorMessage: lastError,
        });
        continue;
      }
      // 响应头已到达 → 解除超时,流式 body 的生成时长不再受其约束
      clearTimeout(headerTimer);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        lastError = errText.slice(0, 500) || `upstream ${response.status}`;
        lastErrorResponse = {
          status: response.status,
          body: errText,
          contentType: response.headers.get("Content-Type") ??
            "application/json",
        };
        await writeRequestLog({
          status: "failed",
          requestType: isFinal ? "final" : "retry",
          httpStatus: response.status,
          latencyMs: Date.now() - startedAt,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          ...logBase(candidate, base),
          errorMessage: lastError,
        });
        continue;
      }

      // 决定消费此响应 → 不再重试其他候选
      if (isStream) {
        const onDone = (usage: Usage | null) => {
          // fire-and-forget,绝不阻塞流
          void writeRequestLog({
            status: "success",
            requestType: "final",
            httpStatus: response.status,
            latencyMs: Date.now() - startedAt,
            promptTokens: usage?.prompt_tokens ?? null,
            completionTokens: usage?.completion_tokens ?? null,
            totalTokens: usage?.total_tokens ?? null,
            ...logBase(candidate, base),
            errorMessage: null,
          }).catch(() => {});
        };
        const upstream = response.body ??
          new ReadableStream<Uint8Array>({ start: (c) => c.close() });
        const stream = upstream.pipeThrough(createUsageSniffingStream(onDone));
        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": response.headers.get("Content-Type") ??
              "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      }

      const text = await response.text();
      const usage = parseUsage(text);
      await writeRequestLog({
        status: "success",
        requestType: "final",
        httpStatus: response.status,
        latencyMs: Date.now() - startedAt,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
        ...logBase(candidate, base),
        errorMessage: null,
      });
      return new Response(text, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("Content-Type") ??
            "application/json",
        },
      });
    }

    // 所有候选都失败:优先透传上游真实错误体(保留 403/insufficient_user_quota 等)
    if (lastErrorResponse) {
      return new Response(lastErrorResponse.body, {
        status: lastErrorResponse.status,
        headers: { "Content-Type": lastErrorResponse.contentType },
      });
    }
    return openaiError(lastError ?? "Upstream request failed", {
      status: 502,
      type: "api_error",
    });
  },
});
