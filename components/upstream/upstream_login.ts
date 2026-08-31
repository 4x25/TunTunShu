export const UPSTREAM_LOGIN_SCRIPT_PATH = "/tuntunshu-login.user.js";
export const UPSTREAM_LOGIN_SCRIPT_VERSION = "1.0.0";
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
