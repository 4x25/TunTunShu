/* TunTunShu 上游代理 Service Worker(scope '/')。
 *
 * 仅拦截「代理标签」的同源请求,加 X-TTS-Proxy:<会话令牌> 头转发给后端代理;
 * 后台标签与无会话时一律放行,后台工具完全不受影响。
 * 单活跃会话;状态(会话令牌 + 代理 client 集合)持久化于 IndexedDB,以挺过 SW 重启。
 *
 * 取舍:刷新代理标签(导航不带 __ttsup 标记)会放行回落到后台页,重新点「登录」即可。
 */
const DB_NAME = "tts-proxy";
const STORE = "kv";
const HDR = "X-TTS-Proxy";

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  try {
    const db = await openDb();
    return await new Promise((res) => {
      const t = db.transaction(STORE).objectStore(STORE).get(k);
      t.onsuccess = () => res(t.result);
      t.onerror = () => res(undefined);
    });
  } catch {
    return undefined;
  }
}
async function kvSet(k, v) {
  try {
    const db = await openDb();
    await new Promise((res) => {
      const t = db.transaction(STORE, "readwrite").objectStore(STORE).put(v, k);
      t.onsuccess = () => res();
      t.onerror = () => res();
    });
  } catch { /* ignore */ }
}

// 内存态:SESSION undefined=未加载,null=无会话,{token}=活跃。
let SESSION;
let CLIENTS = [];
let loadPromise = null;
function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = (async () => {
      SESSION = (await kvGet("session")) ?? null;
      CLIENTS = (await kvGet("clients")) ?? [];
    })();
  }
  return loadPromise;
}
async function setSession(s) {
  // 单活跃会话:新会话重置 client 集合,旧代理标签不再沿用新令牌。
  SESSION = s;
  CLIENTS = [];
  await kvSet("session", s);
  await kvSet("clients", CLIENTS);
}
async function tagClient(id) {
  if (!id || CLIENTS.includes(id)) return;
  CLIENTS.push(id);
  await kvSet("clients", CLIENTS);
}
async function clearAll() {
  SESSION = null;
  CLIENTS = [];
  await kvSet("session", null);
  await kvSet("clients", []);
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  const m = e.data || {};
  const reply = e.ports && e.ports[0];
  if (m.type === "start" && m.token) {
    e.waitUntil((async () => {
      await ensureLoaded();
      await setSession({ token: m.token });
      if (reply) reply.postMessage("ok");
    })());
  } else if (m.type === "deactivate") {
    e.waitUntil((async () => {
      await ensureLoaded();
      await clearAll();
      if (reply) reply.postMessage("ok");
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // 跨源 → 浏览器默认处理
  const marked = url.searchParams.has("__ttsup") ||
    url.searchParams.has("__ttsexit");
  // 已加载且无会话且无标记 → 零开销放行(后台标签常态)。
  if (SESSION === null && CLIENTS.length === 0 && !marked) return;
  event.respondWith(handle(event, req, url));
});

async function handle(event, req, url) {
  await ensureLoaded();

  if (req.mode === "navigate") {
    if (url.searchParams.has("__ttsexit")) {
      await clearAll();
      return fetch(req); // 放行回后台
    }
    if (url.searchParams.has("__ttsup")) {
      if (!SESSION) return fetch(req); // 无令牌兜底
      await tagClient(event.resultingClientId || event.clientId);
      url.searchParams.delete("__ttsup");
      return proxyFetch(req, url.pathname + url.search);
    }
    return fetch(req); // 其它导航(无会话 / 刷新)→ 放行(已接受的取舍)
  }

  // 子请求:仅代理已打标 client 的请求。
  if (SESSION && event.clientId && CLIENTS.includes(event.clientId)) {
    return proxyFetch(req, null);
  }
  return fetch(req);
}

/** 加 X-TTS-Proxy 头转发到我方后端(同源)。
 *  强制 mode 'same-origin':否则原本 no-cors 的资源请求(CSS/图片)会静默丢弃自定义头,
 *  导致后端收不到 X-TTS-Proxy 而无法代理。目标恒为同源路径,该 mode 始终成立。 */
function proxyFetch(req, pathOverride) {
  const headers = new Headers(req.headers);
  headers.set(HDR, SESSION.token);
  const u = new URL(req.url);
  const target = pathOverride != null ? pathOverride : u.pathname + u.search;
  const init = {
    method: req.method,
    headers,
    mode: "same-origin",
    credentials: "same-origin",
    redirect: "follow",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }
  return fetch(target, init);
}
