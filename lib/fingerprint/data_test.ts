import { supportsDetector } from "./analyze.ts";
import {
  fingerprintDataDirs,
  loadFingerprintData,
  resetFingerprintDataCache,
} from "./data.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("数据目录候选覆盖 dev 与 _fresh 两种布局", () => {
  const sourceDirs = fingerprintDataDirs(
    new URL("file:///repo/lib/fingerprint/data.ts"),
    "/repo",
  ).map((url) => url.href);
  assert(
    sourceDirs.includes("file:///repo/data/fingerprint/"),
    "source layout",
  );
  const builtDirs = fingerprintDataDirs(
    new URL("file:///repo/_fresh/server/assets/chunk.mjs"),
    "/repo",
  ).map((url) => url.href);
  assert(
    builtDirs.includes("file:///repo/_fresh/fingerprint-data/"),
    "_fresh top-level",
  );
  assert(
    builtDirs.includes("file:///repo/_fresh/server/fingerprint-data/"),
    "_fresh server",
  );
});

Deno.test("加载随仓库发布的指纹参考库与检测器", async () => {
  resetFingerprintDataCache();
  const { bank, detector } = await loadFingerprintData();
  assert(
    bank.models.length === 60,
    `unexpected model count ${bank.models.length}`,
  );
  assert(
    detector.model_ids.length === bank.models.length,
    "model count mismatch",
  );
  assert(
    detector.ranker.references.length === bank.models.length,
    "reference count",
  );
  assert(detector.ranker.references[0].length > 0, "empty references");
  assert(supportsDetector(bank, detector), "bank/detector mismatch");
  assert(
    bank.models.every((model) => model.display_name && model.family_name),
    "missing display metadata",
  );
});
