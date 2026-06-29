import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

// AI SDK 仅用于服务端(Deno 运行时直接执行),不应进入 rollup 打包:
// 其传递依赖 @ai-sdk/gateway → @vercel/oidc 的 CJS 具名导出无法被 rollup 解析。
// 一律标记为 external,运行时由 deno.json 的 import map + node_modules 解析裸导入。
// 同时匹配裸标识符与 Deno 的 .deno/node_modules 解析后路径,确保两种 build 环境都生效。
const isAiExternal = (id: string): boolean =>
  id === "ai" ||
  id.startsWith("ai/") ||
  id.includes("@ai-sdk/") ||
  id.includes("@ai-sdk+") ||
  id.includes("@vercel/oidc") ||
  id.includes("@vercel+oidc") ||
  /[/]ai@\d/.test(id) ||
  /[/]node_modules[/]ai[/]/.test(id);

export default defineConfig({
  plugins: [fresh(), tailwindcss()],
  ssr: {
    external: [
      "ai",
      "@ai-sdk/openai",
      "@ai-sdk/anthropic",
      "@ai-sdk/google",
      "@ai-sdk/gateway",
      "@ai-sdk/provider",
      "@ai-sdk/provider-utils",
      "@vercel/oidc",
    ],
  },
  build: { rollupOptions: { external: isAiExternal } },
});
