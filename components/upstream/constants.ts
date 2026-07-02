import type { TestKind } from "./types.ts";

export const ENDPOINT_LABELS: Record<string, string> = {
  openai_chat: "OpenAI chat",
  openai_responses: "OpenAI responses",
  claude_messages: "Claude messages",
  gemini_generate: "Gemini generate",
};

export const ENDPOINT_OPTIONS = Object.keys(ENDPOINT_LABELS);

export const TEST_KINDS: { kind: TestKind; label: string }[] = [
  { kind: "chat", label: "对话测试" },
  { kind: "vision", label: "图像识别" },
  { kind: "tool", label: "工具调用" },
];

export const STATUS_MAP: Record<string, [string, string]> = {
  healthy: ["ok", "正常"],
  down: ["bad", "异常"],
  invalid: ["bad", "失效"],
  quota_empty: ["warn", "额度耗尽"],
  unknown: ["mute", "未知"],
};

export const CHECKIN_MAP: Record<string, [string, string]> = {
  checked: ["ok", "已签到"],
  unchecked: ["mute", "未签到"],
  failed: ["bad", "签到失败"],
  manual_required: ["warn", "需手动"],
  unknown: ["mute", "未知"],
};

export const PAGE_SIZE = 50;
export const QUOTA_PER_USD = 500000; // new-api 约定:500000 quota = $1

export function hit(s: string, q: string): boolean {
  return s.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0;
}

export function maskKey(k: string): string {
  return k.length > 12 ? `${k.slice(0, 6)}••••${k.slice(-4)}` : k;
}

export function usd(quota: string): number {
  return Number(quota) / QUOTA_PER_USD;
}
