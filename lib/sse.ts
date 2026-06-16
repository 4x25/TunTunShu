import type { Usage } from "../types/openai.ts";

function extractUsage(payload: string, current: Usage | null): Usage | null {
  if (!payload || payload === "[DONE]") return current;
  try {
    const obj = JSON.parse(payload) as { usage?: Partial<Usage> | null };
    if (obj?.usage && typeof obj.usage.total_tokens === "number") {
      return obj.usage as Usage;
    }
  } catch {
    // 半个 JSON / 非标准行,忽略,等待后续 chunk 补全
  }
  return current;
}

/**
 * 透传上游 SSE 流,同时旁路嗅探最后一个携带 usage 的 chunk。
 *
 * new-api 在 `data: [DONE]` 之前会发送一个 `choices:[]` + `usage` 的独立 chunk
 * (前提是请求带了 `stream_options.include_usage`)。本流在不影响实时透传的情况下
 * 累积并解析这些行,在流正常结束(flush)或客户端断开(cancel)时回调 onDone。
 * onDone 只触发一次且自身异常不会影响流。
 */
export function createUsageSniffingStream(
  onDone: (usage: Usage | null) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lastUsage: Usage | null = null;
  let fired = false;

  const fire = () => {
    if (fired) return;
    fired = true;
    try {
      onDone(lastUsage);
    } catch {
      // 写日志失败不应影响流
    }
  };

  const consume = (final: boolean) => {
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, "").trim();
      buffer = buffer.slice(index + 1);
      if (line.startsWith("data:")) {
        lastUsage = extractUsage(line.slice(5).trim(), lastUsage);
      }
    }
    if (final) {
      const line = buffer.replace(/\r$/, "").trim();
      if (line.startsWith("data:")) {
        lastUsage = extractUsage(line.slice(5).trim(), lastUsage);
      }
      buffer = "";
    }
  };

  const transformer = {
    transform(
      chunk: Uint8Array,
      controller: TransformStreamDefaultController<Uint8Array>,
    ) {
      controller.enqueue(chunk); // 先透传,实时性不受解析影响
      buffer += decoder.decode(chunk, { stream: true });
      consume(false);
    },
    flush() {
      buffer += decoder.decode();
      consume(true);
      fire();
    },
    cancel() {
      // 客户端中途断开 → 也写一条日志(token 可能为 null)
      fire();
    },
  } as Transformer<Uint8Array, Uint8Array>;

  return new TransformStream<Uint8Array, Uint8Array>(transformer);
}

/** 纯函数:从完整 SSE 文本中解析最后一个 usage,便于单元测试。 */
export function parseUsageFromLines(text: string): Usage | null {
  let usage: Usage | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("data:")) {
      usage = extractUsage(line.slice(5).trim(), usage);
    }
  }
  return usage;
}
