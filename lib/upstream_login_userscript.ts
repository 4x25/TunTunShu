/** Generate the standalone Violentmonkey upstream PAT-login userscript. */
export function buildUpstreamLoginUserScript(
  opts: { baseUrl: string },
): string {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const installUrl = `${base}/tuntunshu-login.user.js`;

  return `// ==UserScript==
// @name         囤囤鼠 · 上游账号免登
// @namespace    tuntunshu
// @version      1.0.0
// @description  使用囤囤鼠保存的 PAT 在当前标签打开 new-api 后台
// @match        http://*/*
// @match        https://*/*
// @grant        none
// @inject-into  page
// @run-at       document-start
// @noframes
// @updateURL    ${installUrl}
// @downloadURL  ${installUrl}
// ==/UserScript==
${buildUpstreamLoginRuntimeSource()}`;
}

export interface UpstreamAutomationBootstrap {
  origin: string;
  accessToken: string;
  userId: string;
  user: { id: number | string; username: string; role: number };
  tabNonce: string;
  createdAt: number;
}

function serializeAutomationBootstrap(
  bootstrap: UpstreamAutomationBootstrap,
): string {
  return JSON.stringify(bootstrap)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/**
 * CloakBrowser 使用的单一 document-start init script。shared runtime 会同步读取并
 * 删除临时属性，凭据不会进入 URL、history、localStorage 或 sessionStorage。
 */
export function buildUpstreamAutomationInitScript(
  bootstrap: UpstreamAutomationBootstrap,
): string {
  return `if (location.hostname !== "challenges.cloudflare.com") {
  ["WebSocket", "Worker", "SharedWorker", "WebTransport", "RTCPeerConnection",
    "webkitRTCPeerConnection"].forEach(function (name) {
    try {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: undefined
      });
    } catch (_) {}
  });
}
if (globalThis.top === globalThis && location.origin === ${
    JSON.stringify(bootstrap.origin)
  }) {
  Object.defineProperty(globalThis, "__TTS_UPSTREAM_AUTOMATION_BOOTSTRAP__", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: ${serializeAutomationBootstrap(bootstrap)}
  });
}
${buildUpstreamLoginRuntimeSource()}`;
}

/** 免登油猴脚本与 CloakBrowser automation 共用的页面鉴权 runtime。 */
export function buildUpstreamLoginRuntimeSource(): string {
  return `(function () {
  "use strict";

  var SCRIPT_VERSION = "1.0.0";
  var MARKER = "__TTS_UPSTREAM_LOGIN_SCRIPT__";
  var PATCHED = "__TTS_UPSTREAM_LOGIN_PATCHED__";
  var SESSION_KEY = "tts-upstream-login";
  var FRAGMENT_PREFIX = "#__tts_upstream_login__?";
  var NEVER_EXPIRES = 253402300799;
  var AUTHORIZATION = "authorization";
  var NEW_API_USER = "new-api-user";
  var AUTH_SESSION = "x-auth-session";

  globalThis[MARKER] = SCRIPT_VERSION;

  var nativeFetch = globalThis.fetch && globalThis.fetch.bind(globalThis);
  var NativeXHR = globalThis.XMLHttpRequest;
  var NativeStorage = globalThis.Storage;
  if (!nativeFetch || !NativeXHR || !NativeStorage) return;

  var storageProto = NativeStorage.prototype;
  var nativeStorageGet = storageProto.getItem;
  var nativeStorageSet = storageProto.setItem;
  var nativeStorageRemove = storageProto.removeItem;
  var nativeStorageClear = storageProto.clear;

  function sessionGet() {
    try {
      return nativeStorageGet.call(sessionStorage, SESSION_KEY);
    } catch (_) {
      return null;
    }
  }

  function sessionSet(value) {
    nativeStorageSet.call(sessionStorage, SESSION_KEY, JSON.stringify(value));
  }

  function sessionRemove() {
    try {
      nativeStorageRemove.call(sessionStorage, SESSION_KEY);
    } catch (_) {}
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function readStoredSession() {
    var raw = sessionGet();
    if (!raw) return null;
    var value = parseJson(raw);
    if (!value || typeof value !== "object") return null;
    return value;
  }

  function validUserId(value) {
    return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
  }

  function validToken(value) {
    return typeof value === "string" && value.length > 0 &&
      !/[\\r\\n]/.test(value);
  }

  function validUser(value, userId) {
    return value && typeof value === "object" &&
      String(value.id) === userId && typeof value.username === "string" &&
      typeof value.role === "number";
  }

  function validActive(value) {
    return value && value.version === 1 && value.phase === "active" &&
      value.origin === location.origin && validToken(value.accessToken) &&
      validUserId(value.userId) && validUser(value.user, value.userId) &&
      typeof value.tabNonce === "string" && value.tabNonce.length > 0 &&
      typeof value.createdAt === "number";
  }

  function makeNonce() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  }

  function cleanFragment() {
    history.replaceState(null, "", location.pathname + location.search);
  }

  function renderFailure(message) {
    var text = "囤囤鼠免登失败：" + String(message || "未知错误");
    try {
      document.open();
      document.write("<!doctype html><meta charset=utf-8><title>免登失败</title>" +
        "<main style=\\"font:14px/1.7 system-ui;padding:40px;max-width:720px;margin:auto\\">" +
        "<h1 style=\\"font-size:20px\\">免登失败</h1><p>" +
        text.replace(/[&<>]/g, function (char) {
          return char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;";
        }) + "</p><p>请返回囤囤鼠重新点击登录。</p></main>");
      document.close();
    } catch (_) {
      var show = function () {
        if (!document.body) return;
        var node = document.createElement("div");
        node.textContent = text;
        document.body.appendChild(node);
      };
      if (document.body) show();
      else document.addEventListener("DOMContentLoaded", show, { once: true });
    }
  }

  function logoutResponseOk(response, body) {
    return response.status === 204 ||
      (response.ok && body && body.success === true);
  }

  async function clearServerLogin() {
    var modern = await nativeFetch("/api/user/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Cache-Control": "no-store" },
    });
    var modernBody = parseJson(await modern.text());
    if (modern.status === 404 || modern.status === 405) {
      var legacy = await nativeFetch("/api/user/logout", {
        method: "GET",
        credentials: "include",
        headers: { "Cache-Control": "no-store" },
      });
      var legacyBody = parseJson(await legacy.text());
      if (!logoutResponseOk(legacy, legacyBody)) {
        throw new Error((legacyBody && legacyBody.message) ||
          "无法清除旧版登录状态 (HTTP " + legacy.status + ")");
      }
      return;
    }
    if (!logoutResponseOk(modern, modernBody)) {
      throw new Error((modernBody && modernBody.message) ||
        "无法清除登录状态 (HTTP " + modern.status + ")");
    }
  }

  async function requestSelf(accessToken, userId) {
    var response = await nativeFetch("/api/user/self", {
      method: "GET",
      credentials: memoryOnly ? "include" : "omit",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "New-Api-User": userId,
        "Cache-Control": "no-store",
      },
    });
    var text = await response.text();
    var body = parseJson(text);
    if (!response.ok || !body || body.success !== true ||
      !validUser(body.data, userId)) {
      var message = body && (body.message || body.error);
      throw new Error(message || "AccessToken 无效或用户 ID 不匹配");
    }
    return body.data;
  }

  function bootstrapFromFragment() {
    if (typeof location.hash !== "string" ||
      location.hash.indexOf(FRAGMENT_PREFIX) !== 0) return false;

    var params = new URLSearchParams(location.hash.slice(FRAGMENT_PREFIX.length));
    var accessToken = params.get("accessToken") || "";
    var userId = params.get("userId") || "";
    if (!validToken(accessToken) || !validUserId(userId)) {
      cleanFragment();
      sessionRemove();
      globalThis.stop();
      renderFailure("登录参数无效");
      return true;
    }

    var pending = {
      version: 1,
      phase: "pending",
      origin: location.origin,
      accessToken: accessToken,
      userId: userId,
      user: null,
      tabNonce: "",
      createdAt: Date.now(),
    };
    try {
      sessionSet(pending);
    } catch (_) {
      cleanFragment();
      globalThis.stop();
      renderFailure("浏览器拒绝使用 sessionStorage");
      return true;
    }

    cleanFragment();
    globalThis.stop();

    (async function () {
      try {
        await clearServerLogin();
        nativeStorageRemove.call(localStorage, "user");
        nativeStorageRemove.call(localStorage, "uid");
        var user = await requestSelf(accessToken, userId);
        sessionSet({
          version: 1,
          phase: "active",
          origin: location.origin,
          accessToken: accessToken,
          userId: userId,
          user: user,
          tabNonce: makeNonce(),
          createdAt: pending.createdAt,
        });
        location.reload();
      } catch (error) {
        sessionRemove();
        renderFailure(error && error.message ? error.message : error);
      }
    })();
    return true;
  }

  var automation = globalThis.__TTS_UPSTREAM_AUTOMATION_BOOTSTRAP__;
  try { delete globalThis.__TTS_UPSTREAM_AUTOMATION_BOOTSTRAP__; } catch (_) {
    globalThis.__TTS_UPSTREAM_AUTOMATION_BOOTSTRAP__ = undefined;
  }
  var memoryOnly = !!automation;
  var login;
  if (memoryOnly) {
    // 自动化凭据只存在当前 document 的闭包中；先清除 profile 可能遗留的旧状态。
    sessionRemove();
    try {
      nativeStorageRemove.call(localStorage, "user");
      nativeStorageRemove.call(localStorage, "uid");
    } catch (_) {}
    login = {
      version: 1,
      phase: "active",
      origin: automation.origin,
      accessToken: automation.accessToken,
      userId: automation.userId,
      user: automation.user,
      tabNonce: automation.tabNonce,
      createdAt: automation.createdAt,
    };
  } else {
    if (bootstrapFromFragment()) return;
    login = readStoredSession();
    if (globalThis.opener) {
      sessionRemove();
      return;
    }
  }
  if (!validActive(login)) {
    if (sessionGet()) sessionRemove();
    return;
  }
  if (globalThis[PATCHED]) return;
  globalThis[PATCHED] = true;

  var shadowUser = JSON.stringify(login.user);
  var shadowUid = login.userId;
  var loginEnabled = true;

  function deactivateLogin() {
    if (!loginEnabled) return;
    loginEnabled = false;
    shadowUser = null;
    shadowUid = null;
    sessionRemove();
    try {
      nativeStorageRemove.call(localStorage, "user");
      nativeStorageRemove.call(localStorage, "uid");
    } catch (_) {}
    try {
      var bar = document.getElementById &&
        document.getElementById("__tts_upstream_login_bar");
      if (bar) bar.remove();
    } catch (_) {}
  }

  function persistShadowUser(value) {
    var parsed = parseJson(value);
    if (validUser(parsed, login.userId)) {
      shadowUser = value;
      login.user = parsed;
      if (!memoryOnly) {
        try { sessionSet(login); } catch (_) {}
      }
      return;
    }
    deactivateLogin();
    nativeStorageSet.call(localStorage, "user", value);
  }

  storageProto.getItem = function (key) {
    var name = String(key);
    if (!loginEnabled) return nativeStorageGet.call(this, name);
    if (this === localStorage && name === "user") return shadowUser;
    if (this === localStorage && name === "uid") return shadowUid;
    return nativeStorageGet.call(this, name);
  };
  storageProto.setItem = function (key, value) {
    var name = String(key);
    var stringValue = String(value);
    if (!loginEnabled) return nativeStorageSet.call(this, name, stringValue);
    if (memoryOnly && stringValue.indexOf(login.accessToken) !== -1) return;
    if (this === localStorage && name === "user") {
      persistShadowUser(stringValue);
      return;
    }
    if (this === localStorage && name === "uid") {
      var nextUid = String(value);
      if (nextUid !== login.userId) {
        deactivateLogin();
        return nativeStorageSet.call(this, name, nextUid);
      }
      shadowUid = nextUid;
      return;
    }
    return nativeStorageSet.call(this, name, stringValue);
  };
  storageProto.removeItem = function (key) {
    var name = String(key);
    if (!loginEnabled) return nativeStorageRemove.call(this, name);
    if (this === localStorage && name === "user") {
      deactivateLogin();
      return;
    }
    if (this === localStorage && name === "uid") {
      deactivateLogin();
      return;
    }
    return nativeStorageRemove.call(this, name);
  };
  storageProto.clear = function () {
    if (loginEnabled && (this === localStorage || this === sessionStorage)) {
      deactivateLogin();
    }
    return nativeStorageClear.call(this);
  };

  function isSameOriginApi(url) {
    return url.origin === location.origin &&
      (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0);
  }

  function isRefresh(url) {
    return url.pathname === "/api/user/auth/refresh";
  }

  function isLogout(url) {
    return url.pathname === "/api/user/auth/logout" ||
      url.pathname === "/api/user/logout";
  }

  function isPatRotation(url) {
    return url.pathname.replace(/\\/+$/, "") === "/api/user/token";
  }

  function authHeaders(input) {
    var headers = new Headers(input);
    headers.set("Authorization", "Bearer " + login.accessToken);
    headers.set("New-Api-User", login.userId);
    return headers;
  }

  function stripAuthHeaders(input) {
    var headers = new Headers(input);
    headers.delete("Authorization");
    headers.delete("New-Api-User");
    headers.delete("X-Auth-Session");
    return headers;
  }

  function createAuthBundle(user) {
    var now = Math.floor(Date.now() / 1000);
    return {
      success: true,
      message: "",
      data: {
        access_token: login.accessToken,
        token_type: "Bearer",
        access_expires_at: NEVER_EXPIRES,
        user: user,
        session: {
          sid: "tts-pat:" + login.tabNonce,
          current: true,
          login_method: "tuntunshu_pat",
          ip: "",
          user_agent: String(navigator.userAgent || ""),
          created_at: Math.floor(login.createdAt / 1000) || now,
          last_active_at: now,
          expires_at: NEVER_EXPIRES,
        },
      },
    };
  }

  function blockedPatResponse() {
    return new Response(JSON.stringify({
      success: false,
      message: "囤囤鼠 PAT 免登模式禁止旋转 AccessToken",
    }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  async function virtualRefreshFetch() {
    try {
      var user = await requestSelf(login.accessToken, login.userId);
      login.user = user;
      shadowUser = JSON.stringify(user);
      if (!memoryOnly) sessionSet(login);
      return new Response(JSON.stringify(createAuthBundle(user)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      deactivateLogin();
      return new Response(JSON.stringify({
        success: false,
        code: "AUTH_UNAUTHORIZED",
        message: error && error.message ? error.message : "AccessToken 无效",
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  globalThis.fetch = function (input, init) {
    if (!loginEnabled) return nativeFetch(input, init);
    var request = input instanceof Request ? input : null;
    var target = new URL(request ? request.url : String(input), location.href);
    if (!isSameOriginApi(target)) return nativeFetch(input, init);

    if (isPatRotation(target)) return Promise.resolve(blockedPatResponse());
    if (isRefresh(target)) return virtualRefreshFetch();

    var sourceHeaders = init && init.headers !== undefined
      ? init.headers
      : request ? request.headers : undefined;
    var next = Object.assign({}, init || {});
    if (isLogout(target)) {
      deactivateLogin();
      next.headers = stripAuthHeaders(sourceHeaders);
      next.credentials = "include";
    } else {
      next.headers = authHeaders(sourceHeaders);
      next.credentials = memoryOnly ? "include" : "omit";
    }

    if (request) {
      return nativeFetch(new Request(request, next));
    }
    return nativeFetch(input, next);
  };

  var xhrProto = NativeXHR.prototype;
  var nativeXhrOpen = xhrProto.open;
  var nativeXhrSend = xhrProto.send;
  var nativeXhrSetHeader = xhrProto.setRequestHeader;
  var nativeXhrAddListener = xhrProto.addEventListener;
  var nativeXhrRemoveListener = xhrProto.removeEventListener;
  var responseTextGetter = Object.getOwnPropertyDescriptor(xhrProto, "responseText");
  var responseGetter = Object.getOwnPropertyDescriptor(xhrProto, "response");
  var xhrState = new WeakMap();
  var xhrListeners = new WeakMap();

  function clearOwnResponse(xhr) {
    ["readyState", "status", "statusText", "responseText", "response",
      "responseURL", "getAllResponseHeaders", "getResponseHeader"].forEach(
      function (name) {
        try { delete xhr[name]; } catch (_) {}
      },
    );
  }

  xhrProto.addEventListener = function (type, listener, options) {
    var listeners = xhrListeners.get(this);
    if (!listeners) {
      listeners = {};
      xhrListeners.set(this, listeners);
    }
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(listener);
    return nativeXhrAddListener.call(this, type, listener, options);
  };
  xhrProto.removeEventListener = function (type, listener, options) {
    var listeners = xhrListeners.get(this);
    if (listeners && listeners[type]) {
      listeners[type] = listeners[type].filter(function (item) {
        return item !== listener;
      });
    }
    return nativeXhrRemoveListener.call(this, type, listener, options);
  };

  xhrProto.open = function (method, url) {
    clearOwnResponse(this);
    var target = new URL(String(url), location.href);
    if (!loginEnabled) {
      xhrState.set(this, { api: false });
      return nativeXhrOpen.apply(this, arguments);
    }
    xhrState.set(this, {
      method: String(method || "GET").toUpperCase(),
      target: target,
      api: isSameOriginApi(target),
      refresh: isSameOriginApi(target) && isRefresh(target),
      logout: isSameOriginApi(target) && isLogout(target),
      blocked: isSameOriginApi(target) && isPatRotation(target),
    });
    return nativeXhrOpen.apply(this, arguments);
  };

  xhrProto.setRequestHeader = function (name, value) {
    var state = xhrState.get(this);
    var normalized = String(name).toLowerCase();
    if (state && state.api &&
      (normalized === AUTHORIZATION || normalized === NEW_API_USER ||
        (state.logout && normalized === AUTH_SESSION))) return;
    return nativeXhrSetHeader.call(this, name, value);
  };

  function callSyntheticListeners(xhr, type) {
    var property = xhr["on" + type];
    if (typeof property === "function") {
      try { property.call(xhr); } catch (error) { queueMicrotask(function () { throw error; }); }
    }
    var listeners = xhrListeners.get(xhr);
    var current = listeners && listeners[type] ? listeners[type].slice() : [];
    current.forEach(function (listener) {
      try { listener.call(xhr); } catch (error) { queueMicrotask(function () { throw error; }); }
    });
  }

  function syntheticXhr(xhr, status, body) {
    var text = JSON.stringify(body);
    clearOwnResponse(xhr);
    Object.defineProperties(xhr, {
      readyState: { configurable: true, get: function () { return 4; } },
      status: { configurable: true, get: function () { return status; } },
      statusText: { configurable: true, get: function () { return "Forbidden"; } },
      responseText: { configurable: true, get: function () { return text; } },
      response: {
        configurable: true,
        get: function () {
          return xhr.responseType === "json" ? body : text;
        },
      },
      responseURL: { configurable: true, get: function () { return ""; } },
      getAllResponseHeaders: {
        configurable: true,
        value: function () { return "content-type: application/json\\r\\n"; },
      },
      getResponseHeader: {
        configurable: true,
        value: function (name) {
          return String(name).toLowerCase() === "content-type"
            ? "application/json"
            : null;
        },
      },
    });
    queueMicrotask(function () {
      callSyntheticListeners(xhr, "readystatechange");
      callSyntheticListeners(xhr, "load");
      callSyntheticListeners(xhr, "loadend");
    });
  }

  function installRefreshTransform(xhr) {
    var cached = null;
    function transformedText() {
      if (cached !== null) return cached;
      var raw = "";
      try {
        if (xhr.responseType === "json" && responseGetter && responseGetter.get) {
          var nativeJson = responseGetter.get.call(xhr);
          raw = nativeJson == null ? "" : JSON.stringify(nativeJson);
        } else {
          raw = responseTextGetter && responseTextGetter.get
            ? responseTextGetter.get.call(xhr)
            : "";
        }
      } catch (_) {
        return "";
      }
      if (!raw) return raw;
      var body = parseJson(raw);
      if (body && body.success === true && validUser(body.data, login.userId)) {
        login.user = body.data;
        shadowUser = JSON.stringify(body.data);
        if (!memoryOnly) {
          try { sessionSet(login); } catch (_) {}
        }
        cached = JSON.stringify(createAuthBundle(body.data));
      } else {
        deactivateLogin();
        cached = raw;
      }
      return cached;
    }
    Object.defineProperty(xhr, "responseText", {
      configurable: true,
      get: transformedText,
    });
    Object.defineProperty(xhr, "response", {
      configurable: true,
      get: function () {
        var text = transformedText();
        if (xhr.responseType === "json") return parseJson(text);
        return text;
      },
    });
    nativeXhrAddListener.call(xhr, "loadend", transformedText, { once: true });
  }

  xhrProto.send = function (body) {
    var state = xhrState.get(this);
    if (!loginEnabled) return nativeXhrSend.call(this, body);
    if (!state || !state.api) return nativeXhrSend.call(this, body);
    if (state.blocked) {
      syntheticXhr(this, 403, {
        success: false,
        message: "囤囤鼠 PAT 免登模式禁止旋转 AccessToken",
      });
      return;
    }
    if (state.logout) {
      deactivateLogin();
      return nativeXhrSend.call(this, body);
    }
    if (state.refresh) {
      nativeXhrOpen.call(this, "GET", "/api/user/self", true);
      nativeXhrSetHeader.call(this, "Authorization", "Bearer " + login.accessToken);
      nativeXhrSetHeader.call(this, "New-Api-User", login.userId);
      nativeXhrSetHeader.call(this, "Cache-Control", "no-store");
      installRefreshTransform(this);
      return nativeXhrSend.call(this, null);
    }
    nativeXhrSetHeader.call(this, "Authorization", "Bearer " + login.accessToken);
    nativeXhrSetHeader.call(this, "New-Api-User", login.userId);
    return nativeXhrSend.call(this, body);
  };

  function exitLogin() {
    deactivateLogin();
    (async function () {
      try { await clearServerLogin(); } catch (_) {}
      // 旧版登录页是 /login;新版会把该兼容路径重定向到 /sign-in。
      location.replace("/login");
    })();
  }

  function renderBanner() {
    if (!document.body || document.getElementById &&
      document.getElementById("__tts_upstream_login_bar")) return;
    var bar = document.createElement("div");
    bar.id = "__tts_upstream_login_bar";
    bar.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483647;" +
      "max-width:360px;padding:10px 12px;border-radius:10px;background:#111827;" +
      "color:#fff;font:12px/1.45 system-ui;box-shadow:0 6px 24px #0005";
    var title = document.createElement("div");
    title.textContent = "囤囤鼠 PAT 免登 · " + login.user.username +
      " (#" + login.userId + ")";
    title.style.cssText = "font-weight:700;margin-bottom:3px";
    var note = document.createElement("div");
    note.textContent = "Session、2FA、Passkey、Playground 等真实登录功能不可用" +
      (location.protocol === "http:" ? " · HTTP 明文传输" : "");
    note.style.cssText = "opacity:.8;margin-right:48px";
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "退出";
    button.style.cssText = "position:absolute;right:10px;top:10px;border:0;border-radius:6px;" +
      "padding:4px 8px;cursor:pointer;background:#ef4444;color:#fff";
    button.addEventListener("click", exitLogin);
    bar.append(title, note, button);
    document.body.appendChild(bar);
  }

  if (!memoryOnly) {
    if (document.body) renderBanner();
    else document.addEventListener("DOMContentLoaded", renderBanner, { once: true });
  }
})();
`;
}
