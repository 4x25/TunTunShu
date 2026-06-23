// 客户端 Admin API 助手(仅在岛屿的浏览器侧调用)。
// 单用户设计:AUTH_KEY 既是后台登录口令,也是 /api 与 /v1 的 Bearer。
// 登录后将其存入 localStorage,后续请求统一带上。
const TOKEN_KEY = "tts-auth";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch { /* ignore */ }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 调用 /api/*。401 时清除 token 并跳转登录页。 */
export async function api(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getToken()}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    if (globalThis.location.pathname !== "/login") {
      globalThis.location.href = "/login";
    }
    throw new ApiError(401, "Unauthorized");
  }
  return res;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  return await (await api(path)).json() as T;
}

export async function apiSend<T = unknown>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await api(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : `请求失败(${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
