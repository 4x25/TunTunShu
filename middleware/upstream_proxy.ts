// 同源反代上游 new-api 前端的中间件(配合 Service Worker)。
// 代理标签的请求由 SW 打上 `X-TTS-Proxy: <会话令牌>` 头转发至此;后台标签的请求无此头,直接放行。
// 须在 main.ts 中注册于 staticFiles() 之前(虽不再依赖路径,但保持在最前,语义清晰)。
import { define } from "../utils.ts";
import {
  getAccountForProxy,
  proxyRequest,
} from "../services/upstream_proxy_service.ts";
import { verifyProxyToken } from "../lib/proxy_session.ts";

export const upstreamProxyMiddleware = define.middleware(async (ctx) => {
  const token = ctx.req.headers.get("x-tts-proxy");
  if (!token) return ctx.next(); // 非代理请求 → 本应用正常处理

  const accountId = await verifyProxyToken(token);
  if (accountId == null) return new Response("Unauthorized", { status: 401 });

  const account = await getAccountForProxy(accountId);
  if (!account) return new Response("Account not found", { status: 404 });

  const url = new URL(ctx.req.url);
  return await proxyRequest(account, url.pathname + url.search, ctx.req);
});
