import { define } from "../../../utils.ts";
import { NewApiAdapter } from "../../../adapters/new_api_adapter.ts";
import { getSql } from "../../../db/client.ts";
import { defaultSettings } from "../../../lib/config.ts";
import { getAuthKey } from "../../../lib/env.ts";
import { maskKey } from "../../../lib/mask.ts";
import type { ChatCompletionRequest } from "../../../types/openai.ts";

const adapter = new NewApiAdapter();

interface RoutableModel {
  upstream_model_id: number;
  upstream_name: string;
  api_key: string;
  origin: string;
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

async function writeRequestLog(input: {
  status: "success" | "failed";
  requestType: "final" | "retry";
  httpStatus: number | null;
  latencyMs: number;
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
      status, request_type, http_status, latency_ms, request_ip, request_path,
      request_key, request_model, upstream_url, upstream_key, upstream_model,
      upstream_model_id, error_message
    ) values (
      ${input.status}, ${input.requestType}, ${input.httpStatus}, ${input.latencyMs}, ${input.requestIp}, ${input.requestPath},
      ${input.requestKey}, ${input.requestModel}, ${input.upstreamUrl}, ${input.upstreamKey}, ${input.upstreamModel},
      ${input.upstreamModelId}, ${input.errorMessage}
    )
  `;
}

export const handler = define.handlers({
  async POST(ctx) {
    const token = extractBearer(ctx.req);
    if (!token || !(await getProxyKeys()).includes(token)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await ctx.req.json().catch(() => null) as
      | ChatCompletionRequest
      | null;
    if (!body?.model) return new Response("Bad Request", { status: 400 });

    const candidates = shuffle(await findRoutableModels(body.model));
    if (!candidates.length) {
      return new Response("Model not found", { status: 404 });
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
    const requestPath = new URL(ctx.req.url).pathname;
    const requestIp =
      ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    let lastResponse: Response | null = null;
    let lastBody = "";
    let lastError: string | null = null;

    for (const [index, candidate] of attempts.entries()) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);
      const startedAt = Date.now();
      const upstreamUrl = `${candidate.origin}/v1/chat/completions`;
      try {
        const response = await adapter.chatCompletions(
          { origin: candidate.origin, apiKey: candidate.api_key },
          { ...body, model: candidate.upstream_name },
          abortController.signal,
        );
        clearTimeout(timeout);
        const text = await response.text();
        lastResponse = response;
        lastBody = text;
        lastError = response.ok ? null : text.slice(0, 500);
        const isFinal = response.ok || index === attempts.length - 1;
        await writeRequestLog({
          status: response.ok ? "success" : "failed",
          requestType: isFinal ? "final" : "retry",
          httpStatus: response.status,
          latencyMs: Date.now() - startedAt,
          requestIp,
          requestPath,
          requestKey: maskKey(token),
          requestModel: body.model,
          upstreamUrl,
          upstreamKey: maskKey(candidate.api_key),
          upstreamModel: candidate.upstream_name,
          upstreamModelId: candidate.upstream_model_id,
          errorMessage: response.ok ? null : lastError,
        });
        if (response.ok || isFinal) break;
      } catch (error) {
        clearTimeout(timeout);
        lastError = error instanceof Error ? error.message : String(error);
        const isFinal = index === attempts.length - 1;
        await writeRequestLog({
          status: "failed",
          requestType: isFinal ? "final" : "retry",
          httpStatus: null,
          latencyMs: Date.now() - startedAt,
          requestIp,
          requestPath,
          requestKey: maskKey(token),
          requestModel: body.model,
          upstreamUrl,
          upstreamKey: maskKey(candidate.api_key),
          upstreamModel: candidate.upstream_name,
          upstreamModelId: candidate.upstream_model_id,
          errorMessage: lastError,
        });
        if (isFinal) break;
      }
    }

    if (lastResponse) {
      return new Response(lastBody, {
        status: lastResponse.status,
        headers: {
          "Content-Type": lastResponse.headers.get("Content-Type") ??
            "application/json",
        },
      });
    }

    return new Response(
      JSON.stringify({ error: lastError ?? "Upstream request failed" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});
