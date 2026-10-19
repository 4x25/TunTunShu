import {
  fingerprintConfidenceLevel,
  fingerprintDecisionLabel,
  formatFingerprintPercent,
  isLowConfidence,
  normalizeModelName,
  sameModelName,
} from "./fingerprint.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

Deno.test("formatFingerprintPercent 处理空值、正常值与极小值", () => {
  assertEquals(formatFingerprintPercent(null), "—", "null");
  assertEquals(formatFingerprintPercent(0.9234), "92.34%", "normal");
  assertEquals(formatFingerprintPercent(0.00001), "<0.01%", "tiny");
});

Deno.test("置信度阈值与低置信度判断", () => {
  assertEquals(fingerprintConfidenceLevel(null), "empty", "null level");
  assertEquals(fingerprintConfidenceLevel(0.75), "ok", "boundary");
  assertEquals(fingerprintConfidenceLevel(0.749), "warn", "below");
  assertEquals(isLowConfidence(0.749), true, "low");
  assertEquals(isLowConfidence(0.75), false, "not low");
  assertEquals(isLowConfidence(null), false, "null is not low");
});

Deno.test("决策文案覆盖四种结果", () => {
  assertEquals(
    fingerprintDecisionLabel("prediction"),
    "识别结果",
    "prediction",
  );
  assertEquals(fingerprintDecisionLabel("partial"), "部分样本排名", "partial");
  assertEquals(
    fingerprintDecisionLabel("not_model"),
    "不像语言模型回答",
    "not_model",
  );
  assertEquals(
    fingerprintDecisionLabel("unscorable"),
    "暂不可评分",
    "unscorable",
  );
});

Deno.test("模型名只在归一化后完全相等时匹配", () => {
  assertEquals(
    normalizeModelName("deepseek/DeepSeek-V4.1-Flash"),
    "deepseek-v4.1-flash",
    "normalize",
  );
  assertEquals(
    sameModelName("DeepSeek-V4.1-Flash", "deepseek-v4.1-flash"),
    true,
    "same",
  );
  assertEquals(
    sameModelName("deepseek-v4.1", "deepseek-v4.1-flash"),
    false,
    "no partial match",
  );
  assertEquals(
    sameModelName("gpt-4.1", "gpt-41"),
    false,
    "keep dot distinction",
  );
  assertEquals(
    sameModelName("qwen2.5:72b", "qwen2.5-72b"),
    true,
    "colon as separator",
  );
});
