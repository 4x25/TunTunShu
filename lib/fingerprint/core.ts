// 数字指纹的基础解析与特征。
// Ported from Ikaleio/lm-detector (MIT); original: shared/fingerprint-core.js.

export const VALUE_MIN = 1;
export const VALUE_MAX = 355;
export const DIMENSION = VALUE_MAX - VALUE_MIN + 1;
export const ALPHA = 0.5;

/**
 * 取回复中最长的一段有效整数。
 * 数字之间出现字母时视为分段(前言、解释文字会把数字切开),只保留 1–355 的值。
 */
export function parseNumbers(text: string): number[] {
  const runs: number[][] = [];
  let current: number[] = [];
  let previousEnd = 0;
  for (const match of String(text).matchAll(/\d+/g)) {
    const start = match.index ?? 0;
    const separator = String(text).slice(previousEnd, start);
    const value = Number(match[0]);
    if (current.length && /\p{L}/u.test(separator)) {
      runs.push(current);
      current = [];
    }
    if (value >= VALUE_MIN && value <= VALUE_MAX) current.push(value);
    previousEnd = start + match[0].length;
  }
  if (current.length) runs.push(current);
  return runs.reduce(
    (best, run) => run.length > best.length ? run : best,
    [],
  );
}

export function countNumbers(numbers: number[]): number[] {
  const counts = Array(DIMENSION).fill(0) as number[];
  numbers.forEach((number) => {
    counts[number - VALUE_MIN] += 1;
  });
  return counts;
}

export function hellingerFeature(counts: number[]): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0) +
    ALPHA * DIMENSION;
  return counts.map((value) => Math.sqrt((value + ALPHA) / total));
}

function splitIntoFour(values: number[]): number[][] {
  const base = Math.floor(values.length / 4);
  const remainder = values.length % 4;
  const chunks: number[][] = [];
  let start = 0;
  for (let index = 0; index < 4; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    chunks.push(values.slice(start, start + size));
    start += size;
  }
  return chunks;
}

export function orderedBlockFeature(numbers: number[]): number[] {
  const pieces: number[] = [];
  for (const chunk of splitIntoFour(numbers)) {
    const bins = Array(16).fill(0.5) as number[];
    for (const value of chunk) {
      const index = Math.min(15, Math.floor(((value - 1) / 355) * 16));
      bins[index] += 1;
    }
    const total = bins.reduce((sum, value) => sum + value, 0);
    pieces.push(...bins.map((value) => Math.sqrt(value / total)));
  }
  const lastDigits = Array(10).fill(0.5) as number[];
  numbers.forEach((value) => {
    lastDigits[value % 10] += 1;
  });
  const lastTotal = lastDigits.reduce((sum, value) => sum + value, 0);
  pieces.push(...lastDigits.map((value) => Math.sqrt(value / lastTotal)));
  return pieces;
}
