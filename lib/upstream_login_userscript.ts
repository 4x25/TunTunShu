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

/** 「囤囤鼠脚本」与 CloakBrowser automation 共用的页面鉴权 runtime。 */
export function buildUpstreamLoginRuntimeSource(): string {
  return `(function () {
  "use strict";

  // 页面 realm:Violentmonkey 的 @inject-into page 下 unsafeWindow === window;
  // Tampermonkey 等沙箱环境下 unsafeWindow 才指向真正的页面 window。
  var PAGE = (typeof unsafeWindow !== "undefined" && unsafeWindow)
    ? unsafeWindow
    : globalThis;

  var SCRIPT_VERSION = "2.0.1";
  var MARKER = "__TTS_UPSTREAM_LOGIN_SCRIPT__";
  // 合并后的「囤囤鼠脚本」会注入 TTS_UPSTREAM_UI,用于把退出现有登录态、
  // 验证令牌等步骤的进度显示到页面小胶囊按钮;CloakBrowser automation 没有该
  // 对象时保持纯后台行为。
  var ui = (typeof TTS_UPSTREAM_UI !== "undefined" && TTS_UPSTREAM_UI)
    ? TTS_UPSTREAM_UI
    : null;
  var PATCHED = "__TTS_UPSTREAM_LOGIN_PATCHED__";
  var SESSION_KEY = "tts-upstream-login";
  var FRAGMENT_PREFIX = "#__tts_upstream_login__?";
  var NEVER_EXPIRES = 253402300799;
  var AUTHORIZATION = "authorization";
  var NEW_API_USER = "new-api-user";
  var AUTH_SESSION = "x-auth-session";

  PAGE[MARKER] = SCRIPT_VERSION;

  var nativeFetch = PAGE.fetch && PAGE.fetch.bind(PAGE);
  var NativeXHR = PAGE.XMLHttpRequest;
  var NativeStorage = PAGE.Storage;
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
    if (PAGE.crypto && typeof PAGE.crypto.randomUUID === "function") {
      return PAGE.crypto.randomUUID();
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

    var params = new PAGE.URLSearchParams(location.hash.slice(FRAGMENT_PREFIX.length));
    var accessToken = params.get("accessToken") || "";
    var userId = params.get("userId") || "";
    if (!validToken(accessToken) || !validUserId(userId)) {
      cleanFragment();
      sessionRemove();
      PAGE.stop();
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
      PAGE.stop();
      renderFailure("浏览器拒绝使用 sessionStorage");
      return true;
    }

    cleanFragment();
    PAGE.stop();

    (async function () {
      try {
        // 分步展示免登前的准备动作(和快捷录入共用同一个小胶囊进度条)。
        if (ui) ui.progress("退出登录态…", 20);
        await clearServerLogin();
        nativeStorageRemove.call(localStorage, "user");
        nativeStorageRemove.call(localStorage, "uid");
        if (ui) ui.progress("验证令牌…", 60);
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
        if (ui) ui.progress("免登完成", 100);
        // 免登完成后直接进入个人中心。
        location.replace(location.origin + "/profile");
      } catch (error) {
        sessionRemove();
        if (ui) ui.fail(error && error.message ? error.message : error);
        renderFailure(error && error.message ? error.message : error);
      }
    })();
    return true;
  }

  var automation = PAGE.__TTS_UPSTREAM_AUTOMATION_BOOTSTRAP__;
  try { delete PAGE.__TTS_UPSTREAM_AUTOMATION_BOOTSTRAP__; } catch (_) {
    PAGE.__TTS_UPSTREAM_AUTOMATION_BOOTSTRAP__ = undefined;
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
    if (PAGE.opener) {
      sessionRemove();
      return;
    }
  }
  if (!validActive(login)) {
    if (sessionGet()) sessionRemove();
    return;
  }
  if (PAGE[PATCHED]) return;
  PAGE[PATCHED] = true;

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

  function stripTrailingSlash(path) {
    var end = path.length;
    while (end > 1 && path.charAt(end - 1) === "/") end--;
    return path.slice(0, end);
  }

  // PAT 免登没有上游浏览器 Session。Passkey 状态/管理与登录会话管理属于「Session
  // 专属」端点:上游会对 PAT 返回 401/403,而上游前端把 401 当成登录过期并清掉
  // localStorage.user,连带把免登状态一起清掉。这里对这些端点做响应兜底:成功响应
  // (新版 new-api 的 passkey 接受 PAT)原样透传,鉴权失败则改写成合成结果。
  function sessionOnlyKind(url) {
    var path = stripTrailingSlash(url.pathname);
    if (path === "/api/user/passkey" || path.indexOf("/api/user/passkey/") === 0) {
      return "passkey";
    }
    if (path === "/api/user/sessions" || path.indexOf("/api/user/sessions/") === 0) {
      return "sessions";
    }
    return null;
  }

  function isSessionAuthFailure(status, body) {
    if (status === 401 || status === 403) return true;
    return !!(body && typeof body.code === "string" &&
      body.code.indexOf("AUTH_") === 0);
  }

  function sessionOnlyBody(kind, method) {
    if (String(method || "GET").toUpperCase() !== "GET") {
      return {
        success: false,
        message: "囤囤鼠 PAT 免登模式不支持该 Passkey / 会话操作",
      };
    }
    if (kind === "passkey") {
      return { success: true, message: "", data: { enabled: false } };
    }
    return { success: true, message: "", data: [] };
  }

  function sessionOnlyResponse(kind, method) {
    return new PAGE.Response(JSON.stringify(sessionOnlyBody(kind, method)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function guardSessionOnlyFetch(response, kind, method) {
    if (!response) return response;
    var clone;
    try { clone = response.clone(); } catch (_) { return response; }
    return clone.text().then(function (text) {
      var body = text ? parseJson(text) : null;
      if (!isSessionAuthFailure(response.status, body)) return response;
      return sessionOnlyResponse(kind, method);
    }).catch(function () {
      return response;
    });
  }

  function authHeaders(input) {
    var headers = new PAGE.Headers(input);
    headers.set("Authorization", "Bearer " + login.accessToken);
    headers.set("New-Api-User", login.userId);
    return headers;
  }

  function stripAuthHeaders(input) {
    var headers = new PAGE.Headers(input);
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
    return new PAGE.Response(JSON.stringify({
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
      return new PAGE.Response(JSON.stringify(createAuthBundle(user)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      deactivateLogin();
      return new PAGE.Response(JSON.stringify({
        success: false,
        code: "AUTH_UNAUTHORIZED",
        message: error && error.message ? error.message : "AccessToken 无效",
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  PAGE.fetch = function (input, init) {
    if (!loginEnabled) return nativeFetch(input, init);
    var request = input instanceof PAGE.Request ? input : null;
    var target = new PAGE.URL(request ? request.url : String(input), location.href);
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

    var pending = request
      ? nativeFetch(new PAGE.Request(request, next))
      : nativeFetch(input, next);
    var sessionOnly = sessionOnlyKind(target);
    if (!sessionOnly) return pending;
    var method = (init && init.method) || (request && request.method) || "GET";
    return pending.then(function (response) {
      return guardSessionOnlyFetch(response, sessionOnly, method);
    });
  };

  var xhrProto = NativeXHR.prototype;
  var nativeXhrOpen = xhrProto.open;
  var nativeXhrSend = xhrProto.send;
  var nativeXhrSetHeader = xhrProto.setRequestHeader;
  var nativeXhrAddListener = xhrProto.addEventListener;
  var nativeXhrRemoveListener = xhrProto.removeEventListener;
  var responseTextGetter = Object.getOwnPropertyDescriptor(xhrProto, "responseText");
  var responseGetter = Object.getOwnPropertyDescriptor(xhrProto, "response");
  var statusGetter = Object.getOwnPropertyDescriptor(xhrProto, "status");
  var statusTextGetter = Object.getOwnPropertyDescriptor(xhrProto, "statusText");
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
    var target = new PAGE.URL(String(url), location.href);
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
      sessionOnly: isSameOriginApi(target) ? sessionOnlyKind(target) : null,
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

  function syntheticXhr(xhr, status, body, statusText) {
    var text = JSON.stringify(body);
    clearOwnResponse(xhr);
    Object.defineProperties(xhr, {
      readyState: { configurable: true, get: function () { return 4; } },
      status: { configurable: true, get: function () { return status; } },
      statusText: { configurable: true, get: function () { return statusText; } },
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

  function installSessionOnlyGuard(xhr, kind, method) {
    var inspected = null;
    function nativeText() {
      try {
        if (xhr.responseType === "json" && responseGetter && responseGetter.get) {
          var value = responseGetter.get.call(xhr);
          return value == null ? "" : JSON.stringify(value);
        }
        return responseTextGetter && responseTextGetter.get
          ? responseTextGetter.get.call(xhr)
          : "";
      } catch (_) {
        return "";
      }
    }
    function nativeStatus() {
      return statusGetter && statusGetter.get ? statusGetter.get.call(xhr) : 0;
    }
    function nativeStatusText() {
      return statusTextGetter && statusTextGetter.get
        ? statusTextGetter.get.call(xhr)
        : "";
    }
    function inspect() {
      if (inspected) return inspected;
      // 请求未完成时不缓存,避免把中间态当成最终结果。
      if (xhr.readyState !== 4) {
        return {
          status: nativeStatus(),
          statusText: nativeStatusText(),
          text: "",
        };
      }
      var text = nativeText();
      var body = text ? parseJson(text) : null;
      if (isSessionAuthFailure(nativeStatus(), body)) {
        inspected = {
          status: 200,
          statusText: "OK",
          text: JSON.stringify(sessionOnlyBody(kind, method)),
        };
      } else {
        inspected = {
          status: nativeStatus(),
          statusText: nativeStatusText(),
          text: text,
        };
      }
      return inspected;
    }
    Object.defineProperties(xhr, {
      status: {
        configurable: true,
        get: function () { return inspect().status; },
      },
      statusText: {
        configurable: true,
        get: function () { return inspect().statusText; },
      },
      responseText: {
        configurable: true,
        get: function () { return inspect().text; },
      },
      response: {
        configurable: true,
        get: function () {
          var result = inspect();
          return xhr.responseType === "json"
            ? parseJson(result.text)
            : result.text;
        },
      },
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
      }, "Forbidden");
      return;
    }
    if (state.sessionOnly) {
      nativeXhrSetHeader.call(this, "Authorization", "Bearer " + login.accessToken);
      nativeXhrSetHeader.call(this, "New-Api-User", login.userId);
      installSessionOnlyGuard(this, state.sessionOnly, state.method);
      return nativeXhrSend.call(this, body);
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

  // 合并脚本下,免登状态由页面小胶囊按钮呈现:先展示「注入免登拦截…」步骤,
  // 再切为「免登中(用户名)」,点击后 confirm 确认再退出。
  // 单独注入 automation 时没有 ui,保持纯后台。
  if (!memoryOnly && ui) {
    ui.progress("注入免登拦截…", 80);
    setTimeout(function () {
      if (loginEnabled) ui.activate(login.user, exitLogin);
    }, 0);
  }
})();
`;
}
