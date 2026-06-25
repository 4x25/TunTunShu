// 上游代理会话令牌(HMAC-SHA256,密钥取 AUTH_KEY)。
// 单活跃会话:一个签名令牌即「登录 ticket」也是会话令牌——它绑定 accountId,
// 由 Service Worker 作为 `X-TTS-Proxy` 头随每个代理请求携带,后端验签换取账号。
// 令牌仅含 accountId+exp,泄露最多让持有者在 TTL 内代理该一个账号,且无法得知上游 token。
import { getAuthKey } from "./env.ts";

const DEFAULT_TTL_MS = 8 * 60 * 60_000; // 8 小时

let keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(getAuthKey()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return keyPromise;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** payload(base64url,无点号)+ "." + 签名(base64url)。 */
async function sign(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await getKey(),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** 校验签名与有效期(payload.e);通过则返回 payload 对象,否则 null。 */
async function verify(token: string): Promise<Record<string, unknown> | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await getKey(),
      b64urlDecode(sigPart),
      new TextEncoder().encode(payload),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
  if (typeof data.e !== "number" || Date.now() > data.e) return null;
  return data;
}

/** 签发绑定 accountId 的会话令牌。 */
export function mintProxyToken(
  accountId: number,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<string> {
  const payload = b64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({ a: accountId, e: Date.now() + ttlMs }),
    ),
  );
  return sign(payload);
}

/** 校验会话令牌,通过则返回 accountId,否则 null。 */
export async function verifyProxyToken(token: string): Promise<number | null> {
  const data = await verify(token);
  return typeof data?.a === "number" ? data.a : null;
}
