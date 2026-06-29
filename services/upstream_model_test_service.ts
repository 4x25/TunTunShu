import { generateText, jsonSchema, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getSql } from "../db/client.ts";
import { defaultSettings } from "../lib/config.ts";
import type { EndpointType } from "../types/enums.ts";
import { TEST_IMAGES } from "../lib/test_images.ts";

export type TestKind = "chat" | "vision" | "tool";

export interface TestToolCall {
  name: string;
  input: unknown;
}

export interface TestResult {
  endpointType: EndpointType;
  kind: TestKind;
  prompt: string;
  imageLabel?: string;
  reply: string;
  toolCalls: TestToolCall[];
  pass: boolean;
  reason: string;
  latencyMs: number;
  httpStatus?: number;
  error?: string;
}

// ── 小工具 ────────────────────────────────────────────────────────────
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randCode(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += randInt(0, 9);
  return s;
}
/** 归一化:小写 + 去空白,用于宽松包含匹配。 */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}
/**
 * base64(无前缀)→ 字节。AI SDK 的 file 部件传二进制时,各 provider 会自行编码为
 * data URL / base64 source / inline_data;若直接传裸 base64 字符串,OpenAI provider
 * 会把它当作 URL 原样下发,导致上游报「URL must be ... data or file URL」。
 */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
/** 由 base64 魔数嗅探图片 MIME,用于补 data URL 前缀。 */
function sniffImageMime(b64: string): string {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}
/**
 * @ai-sdk/openai 的 chat 路径会把内联图片的 image_url.url 写成裸 base64(无 data:
 * 前缀),上游会报「URL must be ... data or file URL」。此 fetch 包装在出站请求体里
 * 把裸 base64 的 image_url 补成合法 data URL。仅用于 openai_chat 端点。
 */
const repairImageUrlFetch: typeof globalThis.fetch = (input, init) => {
  const body = init?.body;
  if (typeof body === "string" && body.includes('"image_url"')) {
    try {
      const obj = JSON.parse(body);
      let changed = false;
      for (const m of obj?.messages ?? []) {
        if (!Array.isArray(m?.content)) continue;
        for (const p of m.content) {
          const url = p?.image_url?.url;
          if (
            p?.type === "image_url" && typeof url === "string" &&
            !/^(https?:|data:|file:)/i.test(url)
          ) {
            p.image_url.url = `data:${sniffImageMime(url)};base64,${url}`;
            changed = true;
          }
        }
      }
      if (changed) return fetch(input, { ...init, body: JSON.stringify(obj) });
    } catch {
      // 解析失败则原样发送
    }
  }
  return fetch(input, init);
};

// ── 按端点类型构造 AI SDK 语言模型(baseURL=上游 origin, apiKey=上游 key) ──
function buildModel(
  ep: EndpointType,
  origin: string,
  key: string,
  name: string,
) {
  const base = origin.replace(/\/+$/, "");
  // new-api 各格式端点通常都接受 Bearer;Anthropic/Gemini provider 默认分别发
  // x-api-key / x-goog-api-key,这里再补 Authorization 兜底。
  const headers = { Authorization: `Bearer ${key}` };
  switch (ep) {
    case "openai_chat":
      return createOpenAI({
        baseURL: `${base}/v1`,
        apiKey: key,
        fetch: repairImageUrlFetch,
      }).chat(name);
    case "openai_responses":
      return createOpenAI({ baseURL: `${base}/v1`, apiKey: key }).responses(
        name,
      );
    case "claude_messages":
      return createAnthropic({ baseURL: `${base}/v1`, apiKey: key, headers })
        .languageModel(name);
    case "gemini_generate":
      return createGoogleGenerativeAI({
        baseURL: `${base}/v1beta`,
        apiKey: key,
        headers,
      }).languageModel(name);
    default: {
      const _exhaustive: never = ep;
      throw new Error(`未知端点类型: ${_exhaustive}`);
    }
  }
}

type Model = ReturnType<typeof buildModel>;
interface CaseOut {
  text: string;
  toolCalls: TestToolCall[];
}
interface CaseSpec {
  prompt: string;
  imageLabel?: string;
  run: (model: Model, signal: AbortSignal) => Promise<CaseOut>;
  judge: (out: CaseOut) => { pass: boolean; reason: string };
}

const MAX_OUTPUT_TOKENS = 300;

// ── 三类随机测试用例 ───────────────────────────────────────────────────
function buildCase(kind: TestKind): CaseSpec {
  if (kind === "chat") {
    if (Math.random() < 0.5) {
      const a = randInt(10, 99), b = randInt(10, 99);
      const expect = String(a + b);
      const prompt = pick([
        `请计算 ${a} + ${b}，只回答数字。`,
        `${a} 加 ${b} 等于多少？只给出数字。`,
        `算一下 ${a}+${b} 的结果（仅数字）。`,
      ]);
      return {
        prompt,
        run: async (model, signal) => {
          const r = await generateText({
            model,
            messages: [{ role: "user", content: prompt }],
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            maxRetries: 0,
            abortSignal: signal,
          });
          return { text: r.text ?? "", toolCalls: [] };
        },
        judge: (out) => {
          const pass = norm(out.text).includes(norm(expect));
          return {
            pass,
            reason: pass
              ? `回复包含正确答案「${expect}」`
              : `回复未包含正确答案「${expect}」`,
          };
        },
      };
    }
    const code = randCode(6);
    const prompt = pick([
      `请原样返回这串验证码：${code}`,
      `复述这串字符（只回字符本身）：${code}`,
      `把下面的码原封不动重复一遍：${code}`,
    ]);
    return {
      prompt,
      run: async (model, signal) => {
        const r = await generateText({
          model,
          messages: [{ role: "user", content: prompt }],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          maxRetries: 0,
          abortSignal: signal,
        });
        return { text: r.text ?? "", toolCalls: [] };
      },
      judge: (out) => {
        const pass = norm(out.text).includes(norm(code));
        return {
          pass,
          reason: pass
            ? `回复包含验证码「${code}」`
            : `回复未包含验证码「${code}」`,
        };
      },
    };
  }

  if (kind === "vision") {
    const img = pick(TEST_IMAGES);
    const prompt = pick([
      "这张图片主要是什么颜色？用一个词回答。",
      "图中最醒目的颜色是什么？",
      "请说出图片里那个形状的颜色。",
      "看看这张图,它的主色调是？",
    ]);
    return {
      prompt,
      imageLabel: img.label,
      run: async (model, signal) => {
        const r = await generateText({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "file",
                data: b64ToBytes(img.data),
                mediaType: img.mediaType,
              },
            ],
          }],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          maxRetries: 0,
          abortSignal: signal,
        });
        return { text: r.text ?? "", toolCalls: [] };
      },
      judge: (out) => {
        const hit = img.answers.find((a) => norm(out.text).includes(norm(a)));
        return {
          pass: !!hit,
          reason: hit
            ? `识别到颜色「${hit}」`
            : `未识别出预期颜色(应包含:${img.answers.join(" / ")})`,
        };
      },
    };
  }

  // kind === "tool"
  if (Math.random() < 0.5) {
    const city = pick(["北京", "上海", "东京", "巴黎", "纽约", "柏林", "杭州"]);
    const prompt = pick([
      `${city}现在天气怎么样？`,
      `帮我查一下${city}今天的天气。`,
      `${city}的实时天气如何？`,
    ]);
    const tools = {
      get_weather: tool({
        description: "查询指定城市的实时天气",
        inputSchema: jsonSchema({
          type: "object",
          properties: { city: { type: "string", description: "城市名称" } },
          required: ["city"],
          additionalProperties: false,
        }),
      }),
    };
    return {
      prompt,
      run: async (model, signal) => {
        const r = await generateText({
          model,
          messages: [{ role: "user", content: prompt }],
          tools,
          toolChoice: "auto",
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          maxRetries: 0,
          abortSignal: signal,
        });
        return {
          text: r.text ?? "",
          toolCalls: (r.toolCalls ?? []).map((t) => ({
            name: t.toolName,
            input: t.input,
          })),
        };
      },
      judge: (out) => {
        const call = out.toolCalls.find((c) => c.name === "get_weather");
        if (!call) {
          return { pass: false, reason: "模型未发起 get_weather 工具调用" };
        }
        const cityArg = String(
          (call.input as { city?: unknown })?.city ?? "",
        );
        const argOk = norm(cityArg).includes(norm(city));
        return {
          pass: true,
          reason: argOk
            ? `已调用 get_weather,参数 city=${cityArg}`
            : `已调用 get_weather,但参数 city=「${cityArg}」与「${city}」不符`,
        };
      },
    };
  }
  const a = randInt(10, 99), b = randInt(10, 99);
  const prompt = pick([
    `请用工具计算 ${a} + ${b}。`,
    `用 add 工具算一下 ${a} 加 ${b}。`,
    `调用工具求 ${a}+${b} 的和。`,
  ]);
  const tools = {
    add: tool({
      description: "计算两个整数之和",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          a: { type: "number", description: "加数 a" },
          b: { type: "number", description: "加数 b" },
        },
        required: ["a", "b"],
        additionalProperties: false,
      }),
    }),
  };
  return {
    prompt,
    run: async (model, signal) => {
      const r = await generateText({
        model,
        messages: [{ role: "user", content: prompt }],
        tools,
        toolChoice: "auto",
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        abortSignal: signal,
      });
      return {
        text: r.text ?? "",
        toolCalls: (r.toolCalls ?? []).map((t) => ({
          name: t.toolName,
          input: t.input,
        })),
      };
    },
    judge: (out) => {
      const call = out.toolCalls.find((c) => c.name === "add");
      if (!call) return { pass: false, reason: "模型未发起 add 工具调用" };
      const arg = call.input as { a?: unknown; b?: unknown };
      const argOk = Number(arg?.a) === a && Number(arg?.b) === b;
      return {
        pass: true,
        reason: argOk
          ? `已调用 add,参数 a=${a}, b=${b}`
          : `已调用 add,但参数与期望(a=${a}, b=${b})不符`,
      };
    },
  };
}

async function resolveTimeoutMs(): Promise<number> {
  const sql = getSql();
  const rows = await sql<{ value: string }[]>`
    select value from system_settings
    where key = 'upstream_header_timeout_seconds' limit 1
  `;
  const n = Number(
    rows[0]?.value ?? defaultSettings.upstream_header_timeout_seconds,
  );
  const sec = Number.isFinite(n) && n > 0 ? n : 30;
  return Math.max(sec, 15) * 1000;
}

function describeError(err: unknown): { message: string; httpStatus?: number } {
  const e = err as {
    name?: string;
    message?: string;
    statusCode?: number;
    responseBody?: string;
  };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return { message: "请求超时" };
  }
  const status = typeof e?.statusCode === "number" ? e.statusCode : undefined;
  const body = typeof e?.responseBody === "string"
    ? e.responseBody.slice(0, 300)
    : "";
  const base = e?.message ?? String(err);
  const message = [status, base, body && `| ${body}`]
    .filter(Boolean).join(" ").slice(0, 400);
  return { message, httpStatus: status };
}

/** 对某个上游模型按其 endpoint_type 直连上游发起一次测试。 */
export async function testUpstreamModel(
  id: number,
  kind: TestKind,
): Promise<TestResult> {
  const sql = getSql();
  const rows = await sql<{
    upstream_name: string;
    endpoint_type: EndpointType;
    api_key: string;
    origin: string;
  }[]>`
    select upstream_models.name as upstream_name,
           upstream_models.endpoint_type,
           api_keys.key as api_key,
           sites.origin
    from upstream_models
    join api_keys on api_keys.id = upstream_models.api_key_id
    join accounts on accounts.id = api_keys.account_id
    join sites    on sites.id    = accounts.site_id
    where upstream_models.id = ${id}
  `;
  const row = rows[0];
  if (!row) {
    return {
      endpointType: "openai_chat",
      kind,
      prompt: "",
      reply: "",
      toolCalls: [],
      pass: false,
      reason: "未找到该上游模型",
      latencyMs: 0,
      error: "not_found",
    };
  }

  const endpointType = row.endpoint_type;
  const spec = buildCase(kind);
  const model = buildModel(
    endpointType,
    row.origin,
    row.api_key,
    row.upstream_name,
  );
  const timeoutMs = await resolveTimeoutMs();
  const startedAt = Date.now();
  try {
    const out = await spec.run(model, AbortSignal.timeout(timeoutMs));
    const { pass, reason } = spec.judge(out);
    return {
      endpointType,
      kind,
      prompt: spec.prompt,
      imageLabel: spec.imageLabel,
      reply: out.text,
      toolCalls: out.toolCalls,
      pass,
      reason,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    const { message, httpStatus } = describeError(err);
    return {
      endpointType,
      kind,
      prompt: spec.prompt,
      imageLabel: spec.imageLabel,
      reply: "",
      toolCalls: [],
      pass: false,
      reason: "请求失败",
      latencyMs: Date.now() - startedAt,
      httpStatus,
      error: message,
    };
  }
}
