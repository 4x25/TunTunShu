// 读取 data/fingerprint/shared_detector.bin。
// 布局:小端 u32 头长度 + UTF-8 JSON 头 + 4 字节对齐填充 + 按字节位置分组的 float32。
// Ported from Ikaleio/lm-detector (MIT); original: shared/detector-codec.ts.

import type { SharedDetector } from "./types.ts";

export function decodeDetector(data: Uint8Array): SharedDetector {
  if (data.byteLength < 8) throw new Error("指纹检测器数据为空或已损坏");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLength = view.getUint32(0, true);
  const start = Math.ceil((4 + headerLength) / 4) * 4;
  if (start > data.byteLength) throw new Error("指纹检测器头部长度无效");
  const count = (data.length - start) / 4;
  if (!Number.isInteger(count)) throw new Error("指纹检测器浮点数据长度无效");
  const raw = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let b = 0; b < 4; b++) raw[i * 4 + b] = data[start + b * count + i];
  }
  const little = new DataView(raw.buffer);
  const floats = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    floats[i] = little.getFloat32(i * 4, true);
  }
  return JSON.parse(
    new TextDecoder().decode(data.subarray(4, 4 + headerLength)),
    (_, value) =>
      value && typeof value === "object" && "$f32" in value
        ? Array.from(floats.subarray(value.$f32, value.$f32 + value.n))
        : value,
  ) as SharedDetector;
}
