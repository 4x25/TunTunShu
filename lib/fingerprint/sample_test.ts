import { finishReasonError, inspectSample, redactSecret } from "./sample.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

function sequence(count: number, start = 1): number[] {
  return Array.from({ length: count }, (_, i) => ((i * 37 + start) % 355) + 1);
}

Deno.test("inspectSample 接受足够数字并截断到期望数量", () => {
  const text = [...sequence(320), 356].join(", ");
  const result = inspectSample(text, 300);
  assertEquals(result.parsedNumbers, 320, "parsed");
  assertEquals(result.usedNumbers, 300, "used");
  assertEquals(result.accepted, true, "accepted");
  assertEquals(result.capped, true, "capped");
  assertEquals(result.rawOutOfRangeCount, 1, "out of range");
});

Deno.test("inspectSample 拒绝数字不足的采样", () => {
  const result = inspectSample(sequence(100).join(", "), 300);
  assertEquals(result.parsedNumbers, 100, "parsed");
  assertEquals(result.minimumNumbers, 165, "minimum");
  assertEquals(result.accepted, false, "accepted");
});

Deno.test("inspectSample 有错误时要求完整数量", () => {
  const partial = inspectSample(sequence(200).join(", "), 300, {
    error: "请求超时",
  });
  assertEquals(partial.accepted, false, "partial with error");
  const complete = inspectSample(sequence(300).join(", "), 300, {
    error: "请求超时",
  });
  assertEquals(complete.accepted, true, "complete despite error");
});

Deno.test("finishReasonError 拒绝未完整结束的输出", () => {
  assertEquals(finishReasonError("stop"), undefined, "stop");
  assertEquals(finishReasonError("length"), "输出被长度限制截断", "length");
  assertEquals(
    finishReasonError("content-filter"),
    "上游内容过滤中断了输出",
    "content-filter",
  );
  assertEquals(
    finishReasonError("error"),
    "输出未完整结束（error）",
    "error",
  );
  assertEquals(
    finishReasonError("other"),
    "输出未完整结束（other）",
    "other",
  );
});

Deno.test("redactSecret 脱敏原文与 URL 编码变体", () => {
  assertEquals(
    redactSecret("key=abc123", "abc123"),
    "key=[REDACTED]",
    "plain",
  );
  assertEquals(
    redactSecret("key=abc%2F123", "abc/123"),
    "key=[REDACTED]",
    "url encoded",
  );
  assertEquals(
    redactSecret("key=abc+123", "abc 123"),
    "key=[REDACTED]",
    "form encoded",
  );
  assertEquals(redactSecret("unchanged", ""), "unchanged", "empty secret");
});

Deno.test("inspectSample 标记最小值 >= 200 的异常分布", () => {
  const text = Array.from({ length: 300 }, (_, i) => 200 + (i * 37) % 156).join(
    ", ",
  );
  const result = inspectSample(text, 300);
  assertEquals(result.anomalous, true, "anomalous");
  assertEquals(result.accepted, true, "still accepted");
});
