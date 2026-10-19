// 加载随仓库发布的指纹参考库与检测器。
// 数据来源:Ikaleio/lm-detector(MIT),快照信息见 data/fingerprint/README.md。

import { supportsDetector } from "./analyze.ts";
import { decodeDetector } from "./detector_codec.ts";
import type {
  FingerprintBank,
  FingerprintBankModel,
  SharedDetector,
} from "./types.ts";

export interface FingerprintData {
  bank: FingerprintBank;
  detector: SharedDetector;
}

let dataPromise: Promise<FingerprintData> | undefined;

/**
 * 依次尝试:
 * - `fingerprint-data/`(生产构建时由 scripts/copy_fingerprint_data.ts 复制到
 *   `_fresh/fingerprint-data/` 和 `_fresh/server/fingerprint-data/`;
 *   构建后的 route chunk 位于 `_fresh/server/assets/`,因此要向上两级)
 * - `../../data/fingerprint/`(deno dev / deno test,模块位于 lib/fingerprint/)
 * - `../data/fingerprint/`(模块被打包到 services/ 或 _fresh/ 时)
 * - `./data/fingerprint/`(服务端 bundle 位于仓库根目录时)
 * - `$PWD/data/fingerprint/`
 */
export function fingerprintDataDirs(moduleUrl: URL, cwd: string): URL[] {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return [
    new URL("./fingerprint-data/", moduleUrl),
    new URL("../fingerprint-data/", moduleUrl),
    new URL("../../fingerprint-data/", moduleUrl),
    new URL("../../../fingerprint-data/", moduleUrl),
    new URL("../../data/fingerprint/", moduleUrl),
    new URL("../data/fingerprint/", moduleUrl),
    new URL("./data/fingerprint/", moduleUrl),
    new URL(`file://${normalized}/data/fingerprint/`),
  ];
}

function candidateDirs(): URL[] {
  return fingerprintDataDirs(new URL(import.meta.url), Deno.cwd());
}

async function readDataFile(name: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (const dir of candidateDirs()) {
    try {
      return await Deno.readFile(new URL(name, dir));
    } catch (error) {
      // 某个候选路径不可读时继续尝试后续路径;全部失败后再抛出最后一个错误。
      lastError = error;
    }
  }
  throw new Error(
    `未找到指纹数据 ${name}，请确认 data/fingerprint 已随构建部署（${
      lastError instanceof Error ? lastError.message : "not found"
    }）`,
  );
}

function parseBank(value: unknown): FingerprintBank {
  if (!value || typeof value !== "object") {
    throw new Error("指纹参考库格式无效");
  }
  const raw = value as Partial<FingerprintBank>;
  if (typeof raw.built_at !== "string" || !Array.isArray(raw.models)) {
    throw new Error("指纹参考库缺少 built_at 或 models");
  }
  const models: FingerprintBankModel[] = raw.models.map((item, index) => {
    const model = item as Partial<FingerprintBankModel>;
    if (
      !model || typeof model.id !== "string" ||
      typeof model.display_name !== "string" ||
      typeof model.family !== "string" ||
      typeof model.family_name !== "string" ||
      typeof model.response_count !== "number"
    ) {
      throw new Error(`指纹参考库第 ${index + 1} 个模型元数据无效`);
    }
    return {
      id: model.id,
      display_name: model.display_name,
      family: model.family,
      family_name: model.family_name,
      response_count: model.response_count,
    };
  });
  return {
    schema: typeof raw.schema === "string" ? raw.schema : "",
    built_at: raw.built_at,
    reference_sha256: typeof raw.reference_sha256 === "string"
      ? raw.reference_sha256
      : undefined,
    models,
  };
}

async function load(): Promise<FingerprintData> {
  const [bankBytes, detectorBytes] = await Promise.all([
    readDataFile("bank.json"),
    readDataFile("shared_detector.bin"),
  ]);
  const bank = parseBank(JSON.parse(new TextDecoder().decode(bankBytes)));
  const detector = decodeDetector(detectorBytes);
  if (!supportsDetector(bank, detector)) {
    throw new Error("指纹参考库与检测器不匹配，请重新同步 data/fingerprint");
  }
  return { bank, detector };
}

/** 首次调用时读取并解码,之后复用;失败时清空缓存以便下次重试。 */
export function loadFingerprintData(): Promise<FingerprintData> {
  dataPromise ??= load().catch((error) => {
    dataPromise = undefined;
    throw error;
  });
  return dataPromise;
}

/** 仅供测试使用。 */
export function resetFingerprintDataCache(): void {
  dataPromise = undefined;
}
