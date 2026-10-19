import {
  countNumbers,
  DIMENSION,
  hellingerFeature,
  orderedBlockFeature,
  parseNumbers,
} from "./core.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

Deno.test("parseNumbers 取最长连续有效数字段", () => {
  assertEquals(parseNumbers("1, 2, 3"), [1, 2, 3], "plain list");
  assertEquals(parseNumbers("abc 42 def 7 8 9"), [7, 8, 9], "longest run");
  assertEquals(parseNumbers("0 1 355 356"), [1, 355], "out of range dropped");
  assertEquals(parseNumbers("no numbers"), [], "empty");
});

Deno.test("countNumbers 生成 355 个桶并统计", () => {
  const counts = countNumbers([1, 1, 355]);
  assertEquals(counts.length, DIMENSION, "dimension");
  assertEquals(counts[0], 2, "first bucket");
  assertEquals(counts[354], 1, "last bucket");
});

Deno.test("hellingerFeature 与 orderedBlockFeature 维度固定", () => {
  const numbers = Array.from({ length: 300 }, (_, i) => (i * 37) % 355 + 1);
  const hellinger = hellingerFeature(countNumbers(numbers));
  const ordered = orderedBlockFeature(numbers);
  assertEquals(hellinger.length, 355, "hellinger length");
  assertEquals(ordered.length, 74, "ordered block length");
  if (!hellinger.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("hellinger contains invalid values");
  }
  if (!ordered.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("ordered block contains invalid values");
  }
});
