// 手动同步模型指纹参考库。
//
// 用法: deno task fingerprint:sync
// 可选: TTS_FINGERPRINT_SOURCE_COMMIT=<commit> deno task fingerprint:sync
//
// 只写入运行期需要的两个文件:
// - data/fingerprint/shared_detector.bin
// - data/fingerprint/bank.json(从上游 unified_bank.json 提取的模型元数据)
//
// 上游数据以 MIT 许可发布,详见 data/fingerprint/LICENSE。

import { supportsDetector } from "../lib/fingerprint/analyze.ts";
import { decodeDetector } from "../lib/fingerprint/detector_codec.ts";
import type { FingerprintBank } from "../lib/fingerprint/types.ts";

const DEFAULT_COMMIT = "654c8334bb53951aaf04cbd61252d163649e1369";
const commit = Deno.env.get("TTS_FINGERPRINT_SOURCE_COMMIT")?.trim() ||
  DEFAULT_COMMIT;
const base =
  `https://raw.githubusercontent.com/Ikaleio/lm-detector/${commit}/data`;
const targetDir = new URL("../data/fingerprint/", import.meta.url);

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`下载失败 HTTP ${response.status}: ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseSourceBank(value: unknown): FingerprintBank & {
  reference_sha256?: string;
} {
  if (!value || typeof value !== "object") {
    throw new Error("上游 unified_bank.json 格式无效");
  }
  const raw = value as Partial<FingerprintBank>;
  if (typeof raw.built_at !== "string" || !Array.isArray(raw.models)) {
    throw new Error("上游 unified_bank.json 缺少 built_at 或 models");
  }
  return {
    schema: typeof raw.schema === "string" ? raw.schema : "",
    built_at: raw.built_at,
    reference_sha256: typeof raw.reference_sha256 === "string"
      ? raw.reference_sha256
      : undefined,
    models: raw.models.map((model) => ({
      id: model.id,
      display_name: model.display_name,
      family: model.family,
      family_name: model.family_name,
      response_count: model.response_count,
    })),
  };
}

const [bankBytes, detectorBytes] = await Promise.all([
  download(`${base}/unified_bank.json`),
  download(`${base}/shared_detector.bin`),
]);
const fullBank = parseSourceBank(
  JSON.parse(new TextDecoder().decode(bankBytes)),
);
const detector = decodeDetector(detectorBytes);

if (fullBank.built_at !== detector.bank_built_at) {
  throw new Error(
    `参考库 built_at(${fullBank.built_at})与检测器(${detector.bank_built_at})不一致`,
  );
}
if (
  fullBank.reference_sha256 &&
  fullBank.reference_sha256 !== detector.source_reference_sha256
) {
  throw new Error(
    "参考库 reference_sha256 与检测器 source_reference_sha256 不一致",
  );
}
if (!supportsDetector(fullBank, detector)) {
  throw new Error("参考库模型列表与检测器 model_ids/response_counts 不一致");
}

await Deno.writeFile(
  new URL("shared_detector.bin", targetDir),
  detectorBytes,
);
await Deno.writeTextFile(
  new URL("bank.json", targetDir),
  JSON.stringify(fullBank, null, 2) + "\n",
);

console.log(
  `已同步 ${fullBank.models.length} 个模型 · 参考库 ${fullBank.built_at} · commit ${commit}`,
);
console.log(`shared_detector.bin sha256 ${await sha256(detectorBytes)}`);
