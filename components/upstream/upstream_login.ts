// 合并后的「囤囤鼠脚本」同时承担快捷录入与上游免登;marker 由脚本在
// document-start 写入,后台据此判断「登录」链接是否可以携带 PAT。
export const UPSTREAM_LOGIN_SCRIPT_VERSION = "2.0.0";
export const UPSTREAM_LOGIN_SCRIPT_MARKER = "__TTS_UPSTREAM_LOGIN_SCRIPT__";

export function isUpstreamLoginScriptInstalled(
  scope: typeof globalThis,
): boolean {
  return Reflect.get(scope, UPSTREAM_LOGIN_SCRIPT_MARKER) ===
    UPSTREAM_LOGIN_SCRIPT_VERSION;
}

export function parsePureHttpOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("站点 Origin 不是有效 URL");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("站点 Origin 必须是无路径、查询或凭据的 HTTP(S) 地址");
  }
  return url.origin;
}

export function buildUpstreamLoginUrl(
  rawOrigin: string,
  accessToken: string,
  userId: string,
): string {
  const origin = parsePureHttpOrigin(rawOrigin);
  const params = new URLSearchParams({ accessToken, userId });
  return `${origin}/#__tts_upstream_login__?${params.toString()}`;
}

/**
 * 计算账号行「登录」链接的 href:仅当免登脚本在本页可用(scriptInstalled)且
 * 站点 Origin 合法时,才把 accessToken/userId 组装进 URL fragment;任一条件
 * 不满足都返回 null,PAT 绝不进入链接/DOM。
 */
export function buildAccountLoginHref(
  scriptInstalled: boolean,
  siteOrigin: string | null | undefined,
  accessToken: string,
  userId: string,
): string | null {
  if (!scriptInstalled || !siteOrigin) return null;
  try {
    return buildUpstreamLoginUrl(siteOrigin, accessToken, userId);
  } catch {
    return null;
  }
}
