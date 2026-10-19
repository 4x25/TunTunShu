// 构建后把指纹运行期数据复制进 _fresh,确保 Deno Deploy 只部署 _fresh 时也能读取。
// 同时复制到 _fresh/fingerprint-data 与 _fresh/server/fingerprint-data:
// 构建后的 route chunk 位于 _fresh/server/assets/,两种布局都能命中 data.ts 的候选路径。
// 由 deno task build 在 vite build 之后调用。

const sourceDir = new URL("../data/fingerprint/", import.meta.url);
const targetDirs = [
  new URL("../_fresh/fingerprint-data/", import.meta.url),
  new URL("../_fresh/server/fingerprint-data/", import.meta.url),
];
const files = ["bank.json", "shared_detector.bin"];

for (const targetDir of targetDirs) {
  await Deno.mkdir(targetDir, { recursive: true });
  for (const name of files) {
    await Deno.copyFile(
      new URL(name, sourceDir),
      new URL(name, targetDir),
    );
  }
}
console.log(
  `已复制指纹数据到 _fresh/fingerprint-data 与 _fresh/server/fingerprint-data (${
    files.join(", ")
  })`,
);
