// 指纹验证结果的纯展示逻辑(与渲染分离,便于测试)。

import type { FingerprintDecision } from "./types.ts";

/** 置信度是参考库内的闭集概率;低于 75% 时显示低置信度提示。 */
export function isLowConfidence(probability: number | null): boolean {
  return probability !== null && Number.isFinite(probability) &&
    probability < 0.75;
}

export type FingerprintConfidenceLevel = "ok" | "warn" | "empty";

export function fingerprintConfidenceLevel(
  probability: number | null,
): FingerprintConfidenceLevel {
  if (probability === null || !Number.isFinite(probability)) return "empty";
  return probability >= 0.75 ? "ok" : "warn";
}

export function formatFingerprintPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const percent = value * 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  return `${percent.toFixed(2)}%`;
}

export function formatFingerprintScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(3);
}

export function formatFingerprintBankDate(value: string): string {
  return value ? value.slice(0, 10) : "—";
}

export function fingerprintDecisionLabel(
  decision: FingerprintDecision,
): string {
  switch (decision) {
    case "prediction":
      return "识别结果";
    case "partial":
      return "部分样本排名";
    case "not_model":
      return "不像语言模型回答";
    default:
      return "暂不可评分";
  }
}

/**
 * 归一化模型名:去掉 `provider/` 前缀,把标点折叠为 `-`(保留数字间的小数点)。
 * 只用于“同一名称”的精确展示,不做包含/模糊匹配。
 */
export function normalizeModelName(name: string): string {
  const last = name.trim().toLowerCase().split("/").pop() ?? "";
  return last
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 仅当归一化后完全相等时才认为名称一致。 */
export function sameModelName(claimed: string, predicted: string): boolean {
  const a = normalizeModelName(claimed);
  const b = normalizeModelName(predicted);
  return a.length > 0 && a === b;
}
