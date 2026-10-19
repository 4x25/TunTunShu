import { analyzeFingerprint, supportsDetector } from "./analyze.ts";
import { loadFingerprintData } from "./data.ts";
import type { FingerprintBank, Output } from "./types.ts";

// 固定样本提取自上游 unified_reference.jsonl 的 claude-haiku-4.5 批次
// (快照 commit 654c8334, MIT);用于验证算法移植与参考库兼容性。
interface Fixture {
  model: string;
  samples: { expected_count: number; text: string }[];
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function fixture(): Promise<Fixture> {
  return JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/claude_haiku_45.json", import.meta.url),
    ),
  ) as Fixture;
}

Deno.test("用参考库样本预测出正确模型", async () => {
  const { bank, detector } = await loadFingerprintData();
  const data = await fixture();
  const outputs: Output[] = data.samples.map((sample) => ({
    text: sample.text,
    expected_count: sample.expected_count,
  }));
  const analysis = analyzeFingerprint(outputs, bank, detector, {
    allowPartial: true,
  });
  assert(analysis.decision === "prediction", `decision ${analysis.decision}`);
  assert(
    analysis.prediction === data.model,
    `prediction ${analysis.prediction}`,
  );
  assert(analysis.used_outputs === 3, `used ${analysis.used_outputs}`);
  assert(
    analysis.probability !== null && analysis.probability > 0.5,
    `probability ${analysis.probability}`,
  );
  assert(analysis.results[0].model === data.model, "top candidate");
});

Deno.test("程序生成的排序数字不生成排名", async () => {
  const { bank, detector } = await loadFingerprintData();
  const text = Array.from({ length: 300 }, (_, i) => i + 1).join(", ");
  const outputs: Output[] = [1, 2, 3].map(() => ({
    text,
    expected_count: 300,
  }));
  const analysis = analyzeFingerprint(outputs, bank, detector, {
    allowPartial: true,
  });
  assert(analysis.decision === "not_model", `decision ${analysis.decision}`);
  assert(analysis.results.length === 0, "should not rank");
});

Deno.test("只有一条有效回答时给出部分排名且没有置信度", async () => {
  const { bank, detector } = await loadFingerprintData();
  const data = await fixture();
  const first = data.samples[0];
  const outputs: Output[] = [
    { text: first.text, expected_count: first.expected_count },
    { text: "", expected_count: data.samples[1].expected_count },
    { text: "", expected_count: data.samples[2].expected_count },
  ];
  const analysis = analyzeFingerprint(outputs, bank, detector, {
    allowPartial: true,
  });
  assert(analysis.decision === "partial", `decision ${analysis.decision}`);
  assert(analysis.used_outputs === 1, `used ${analysis.used_outputs}`);
  assert(analysis.probability === null, "partial must not have probability");
  assert(analysis.results.length === 60, "partial ranking length");
});

Deno.test("参考库与检测器不匹配时拒绝分析", async () => {
  const { bank, detector } = await loadFingerprintData();
  const mismatched: FingerprintBank = { ...bank, built_at: "2000-01-01" };
  assert(!supportsDetector(mismatched, detector), "should not support");
  let threw = false;
  try {
    analyzeFingerprint([], mismatched, detector);
  } catch {
    threw = true;
  }
  assert(threw, "expected mismatch error");
});
