// 同源反代上游 new-api 前端的核心(配合 Service Worker)。
// - getAccountForProxy:取账号的 origin / userId / accessToken。
// - proxyRequest:把请求反代到上游同名路径;对 /api、/v1 注入 Authorization + new-api-user;
//   text/html 响应缓冲并注入登录态 seed + 退出按钮(并剔除 CSP),其余流式直通。
import { getSql } from "../db/client.ts";

export interface ProxyAccount {
  id: number;
  origin: string; // 去尾斜杠
  userId: string;
  accessToken: string;
  name: string;
}

export async function getAccountForProxy(
  id: number,
): Promise<ProxyAccount | null> {
  if (!Number.isFinite(id)) return null;
  const sql = getSql();
  const rows = await sql<
    {
      id: number;
      user_id: string;
      access_token: string;
      name: string;
      origin: string;
    }[]
  >`
    select accounts.id, accounts.user_id, accounts.access_token, accounts.name, sites.origin
    from accounts
    join sites on sites.id = accounts.site_id
    where accounts.id = ${id}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    origin: r.origin.replace(/\/+$/, ""),
    userId: r.user_id,
    accessToken: r.access_token,
    name: r.name,
  };
}

/** 注入到 <head> 首位的脚本:预置登录态(过 _authenticated 守卫)+ 添加「退出代理」浮动按钮。
 *  SW 方案下无需 URL 改写垫片——所有请求由 SW 拦截并打标转发。 */
function buildInject(account: ProxyAccount): string {
  // 最小合法 user,role=100 让管理菜单先显示;守卫随后调 /api/user/self 用真实数据覆盖。
  const userJson = JSON.stringify(JSON.stringify({
    id: Number(account.userId),
    username: account.name,
    role: 100,
    status: 1,
  }));
  const uidJson = JSON.stringify(String(account.userId));
  return `<script>(function(){
  try{localStorage.setItem('user',${userJson});localStorage.setItem('uid',${uidJson});sessionStorage.setItem('ttsup','1');}catch(e){}
  function addExit(){
    if(document.getElementById('__tts_exit'))return;
    var b=document.createElement('button');
    b.id='__tts_exit';b.textContent='退出代理';
    b.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:6px 12px;background:#ef4444;color:#fff;border:none;border-radius:6px;font:13px sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)';
    b.onclick=function(){try{sessionStorage.removeItem('ttsup');}catch(e){}location.href='/upstream?__ttsexit=1';};
    (document.body||document.documentElement).appendChild(b);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addExit);else addExit();
})();</script>`;
}

/** 在上游 HTML 中注入登录态 seed + 退出按钮,并去掉 CSP <meta>。 */
function injectIntoHtml(html: string, account: ProxyAccount): string {
  html = html.replace(
    /<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi,
    "",
  );
  const inject = buildInject(account);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`);
  }
  // 无 <head> 兜底:置于开头。
  return inject + html;
}

// 逐跳头与我方专用头:不向上游转发。
const STRIP_REQUEST = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "cookie", // 不把我方源站 cookie 透给上游
  "referer", // 不泄露我方路径到上游日志
  "x-tts-proxy", // 我方会话令牌,绝不外发
]);

const STRIP_RESPONSE = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "set-cookie", // 不在我方源站落上游 session cookie
  "content-encoding", // body 已被 fetch 解码
  "content-length",
  "content-security-policy", // 否则注入的内联脚本被拦
  "content-security-policy-report-only",
]);

/** 把请求反代到上游同名路径,注入凭据与登录态,HTML 注入、其余流式直通。 */
export async function proxyRequest(
  account: ProxyAccount,
  targetPath: string,
  req: Request,
): Promise<Response> {
  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (STRIP_REQUEST.has(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  // 受 new-api UserAuth 保护的接口:服务端注入凭据(access_token 不进浏览器)。
  if (targetPath.startsWith("/api") || targetPath.startsWith("/v1")) {
    headers.set("Authorization", `Bearer ${account.accessToken}`);
    headers.set("new-api-user", account.userId);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }

  const upstream = await fetch(account.origin + targetPath, init);

  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (STRIP_RESPONSE.has(k.toLowerCase())) continue;
    respHeaders.set(k, v);
  }
  // 把指向上游的重定向改回同源路径,让浏览器留在我方源站、由 SW 再次代理。
  const loc = upstream.headers.get("location");
  if (loc) {
    if (loc.startsWith(account.origin)) {
      respHeaders.set("location", loc.slice(account.origin.length) || "/");
    }
  }

  // HTML:缓冲并注入 seed + 退出按钮;其余流式直通。
  const ctype = upstream.headers.get("content-type") ?? "";
  if (ctype.includes("text/html")) {
    const html = injectIntoHtml(await upstream.text(), account);
    respHeaders.delete("content-length");
    return new Response(html, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
