// 单条指纹采样的解析与有效性判定(纯函数,便于测试)。

import { parseNumbers } from "./core.ts";

export interface SampleInspection {
  parsedNumbers: number;
  usedNumbers: number;
  minimumNumbers: number;
  accepted: boolean;
  rawOutOfRangeCount: number;
  anomalous: boolean;
  capped: boolean;
  normalizedText: string;
}

/** 把不完整的 finishReason 转成用户可读的错误;stop 视为完整。 */
export function finishReasonError(reason: string): string | undefined {
  if (reason === "stop") return undefined;
  if (reason === "length") return "输出被长度限制截断";
  if (reason === "content-filter") return "上游内容过滤中断了输出";
  return `输出未完整结束（${reason}）`;
}

/** 对错误/原文做脱敏;同时处理 URL 编码后的变体。 */
export function redactSecret(value: string, secret: string): string {
  if (!secret) return value;
  const encoded = encodeURIComponent(secret);
  const formEncoded = encoded.replace(/%20/g, "+");
  return value
    .replaceAll(secret, "[REDACTED]")
    .replaceAll(encoded, "[REDACTED]")
    .replaceAll(formEncoded, "[REDACTED]");
}

export interface InspectSampleOptions {
  /** 采样过程中是否发生错误;有错误时要求完整数量才采用。 */
  error?: string;
  /** 流式采样是否因达到目标数量而主动截断。 */
  capped?: boolean;
}

export function inspectSample(
  text: string,
  expectedCount: number,
  options: InspectSampleOptions = {},
): SampleInspection {
  const parsed = parseNumbers(text);
  const minimum = Math.max(80, Math.ceil(expectedCount * 0.55));
  const used = parsed.slice(0, expectedCount);
  const raw = Array.from(text.matchAll(/-?\d+/g), (m) => Number(m[0]));
  const accepted = parsed.length >= minimum &&
    (!options.error || parsed.length >= expectedCount);
  return {
    parsedNumbers: parsed.length,
    usedNumbers: used.length,
    minimumNumbers: minimum,
    accepted,
    rawOutOfRangeCount: raw.filter((n) => n < 1 || n > 355).length,
    anomalous: parsed.length > 0 && Math.min(...parsed) >= 200,
    capped: Boolean(options.capped) || parsed.length > expectedCount,
    normalizedText: used.join(", "),
  };
}
