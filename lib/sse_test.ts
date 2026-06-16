import { createUsageSniffingStream, parseUsageFromLines } from "./sse.ts";
import type { Usage } from "../types/openai.ts";

/** 轻量深比较断言,避免为测试引入外部依赖。 */
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`assertEquals failed: ${a} !== ${b}`);
  }
}

const SSE = [
  'data: {"id":"1","choices":[{"delta":{"content":"He"}}]}\n\n',
  'data: {"id":"1","choices":[{"delta":{"content":"llo"}}]}\n\n',
  'data: {"id":"1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
  "data: [DONE]\n\n",
].join("");

const EXPECTED: Usage = {
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
};

/** 把若干字节块喂入嗅探流,返回透传出的完整文本与捕获到的 usage。 */
async function pipe(
  chunks: Uint8Array[],
): Promise<{ output: string; usage: Usage | null }> {
  let captured: Usage | null = null;
  const stream = createUsageSniffingStream((u) => {
    captured = u;
  });
  const decoder = new TextDecoder();
  const reader = stream.readable.getReader();
  let output = "";
  const reading = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
  })();

  const writer = stream.writable.getWriter();
  for (const chunk of chunks) {
    await writer.write(chunk);
  }
  await writer.close();
  await reading;
  return { output, usage: captured };
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

Deno.test("parseUsageFromLines 解析最后一个 usage", () => {
  assertEquals(parseUsageFromLines(SSE), EXPECTED);
});

Deno.test("parseUsageFromLines 无 usage 时返回 null", () => {
  const noUsage =
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
  assertEquals(parseUsageFromLines(noUsage), null);
});

Deno.test("嗅探流:逐行喂入,透传完整且抓到 usage", async () => {
  const { output, usage } = await pipe([bytes(SSE)]);
  assertEquals(output, SSE);
  assertEquals(usage, EXPECTED);
});

Deno.test("嗅探流:小块切分(跨 chunk 边界)仍能解析 usage", async () => {
  const all = bytes(SSE);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += 7) {
    chunks.push(all.subarray(i, i + 7));
  }
  const { output, usage } = await pipe(chunks);
  assertEquals(output, SSE);
  assertEquals(usage, EXPECTED);
});

Deno.test("嗅探流:无 usage chunk 时回调收到 null", async () => {
  const noUsage =
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
  const { output, usage } = await pipe([bytes(noUsage)]);
  assertEquals(output, noUsage);
  assertEquals(usage, null);
});
