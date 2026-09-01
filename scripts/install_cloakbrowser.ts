import { relative, resolve, sep } from "node:path";

// Vite 会在构建时重建 _fresh,故浏览器安装固定安排在 vite build 之后。把二进制
// 放进最终构建产物并冻结自动更新,确保生产运行时不会因冷启动再次下载或静默换版。
const cacheDir = resolve(Deno.cwd(), "_fresh", "cloakbrowser");
Deno.env.set("CLOAKBROWSER_CACHE_DIR", cacheDir);
Deno.env.set("CLOAKBROWSER_AUTO_UPDATE", "false");

const { binaryInfo, ensureBinary } = await import("cloakbrowser");
const licenseKey = Deno.env.get("CLOAKBROWSER_LICENSE_KEY")?.trim() ||
  undefined;
const binaryPath = await ensureBinary(licenseKey);
const info = binaryInfo();
const relativePath = relative(cacheDir, binaryPath);
if (
  relativePath && relativePath !== ".." &&
  !relativePath.startsWith(`..${sep}`)
) {
  await Deno.writeTextFile(
    resolve(cacheDir, "tuntunshu-install.json"),
    JSON.stringify({
      relativeBinaryPath: relativePath,
      version: info.version,
      tier: info.tier,
      wrapperVersion: "0.5.10",
    }),
  );
}
console.log(
  `[cloakbrowser] build binary ready: ${info.version} (${info.tier})`,
);
