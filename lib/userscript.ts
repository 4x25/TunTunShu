/**
 * 生成合并后的「囤囤鼠脚本」油猴脚本(Tampermonkey/Violentmonkey)。
 *
 * 它把原「快捷录入」与「上游账号免登」两个脚本合并为一份:
 *
 * - 页面左下角只有一个小胶囊按钮,按状态展示:
 *   - 免登状态 → 「免登中（用户名）」,点击后 `confirm` 确认再退出免登;
 *   - 其他状态 → 「快捷录入」,点击执行录入,过程用分步进度条展示;
 * - 免登前置逻辑(退出现有登录态、校验令牌)与快捷录入共用同一个胶囊按钮的
 *   分步进度(`TTS_UPSTREAM_UI.progress`);
 * - 免登完成后自动跳转 `<origin>/profile` 个人中心。
 *
 * baseUrl 与 authKey 在安装时随链接注入:
 * - 二者用 JSON.stringify 注入为 JS 字符串字面量,防止引号截断脚本(注入安全的关键);
 * - 元数据里的 @connect / @updateURL / @downloadURL 用 hostname / encodeURIComponent 处理;
 * - 浏览器侧代码全程不用模板字符串(避免与本模板自身的 ${} 冲突),正则用 [/] 规避反斜杠。
 *
 * 免登 runtime 与 CloakBrowser automation 共用 `buildUpstreamLoginRuntimeSource()`,
 * 由本脚本在小胶囊 UI 之后内联,并把 UI 暴露为 `TTS_UPSTREAM_UI` 供 runtime 调用。
 */
import { buildUpstreamLoginRuntimeSource } from "./upstream_login_userscript.ts";

/** 合并后的「囤囤鼠脚本」版本(同时作为免登 marker 版本)。 */
export const TUNTUNSHU_SCRIPT_VERSION = "2.0.2";

export function buildUserScript(
  opts: { baseUrl: string; authKey: string },
): string {
  const base = opts.baseUrl.replace(/[/]+$/, "");
  let host = "";
  try {
    host = new URL(base).hostname;
  } catch {
    host = "";
  }
  const installUrl = base + "/tuntunshu.user.js?key=" +
    encodeURIComponent(opts.authKey);
  const baseLit = JSON.stringify(base);
  const keyLit = JSON.stringify(opts.authKey);

  return `// ==UserScript==
// @name         囤囤鼠脚本
// @namespace    tuntunshu
// @version      ${TUNTUNSHU_SCRIPT_VERSION}
// @description  在 new-api 站点一键录入站点与账号,并使用保存的 PAT 免登上游后台
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      ${host}
// @inject-into  page
// @updateURL    ${installUrl}
// @downloadURL  ${installUrl}
// @run-at       document-start
// @noframes
// ==/UserScript==
(function () {
  "use strict";
  var TTS_BASE = ${baseLit};
  var TTS_KEY = ${keyLit};

  // ── 小胶囊按钮:免登与快捷录入唯一的页面入口 ─────────────────────
  // 状态机: hidden(未识别 new-api) / idle(快捷录入) / busy(进行中)
  //         / active(免登中) / failed(免登失败)
  var TTS_UPSTREAM_UI = (function () {
    var button = null;
    var bar = null;
    var label = null;
    var mode = "hidden";
    var activeName = "";
    var exitHandler = null;
    var idleHandler = null;
    // 拖拽状态与位置持久化(当前标签页,存 sessionStorage)。
    var POS_KEY = "tts-capsule-pos";
    var dragState = null;
    var suppressClick = false;

    function hostNode() {
      return document.body || document.documentElement || null;
    }

    function clampNumber(value, min, max) {
      if (typeof value !== "number" || !isFinite(value)) return min;
      return Math.max(min, Math.min(max, value));
    }

    function viewportSize() {
      var el = document.documentElement;
      var width = typeof globalThis.innerWidth === "number"
        ? globalThis.innerWidth
        : 0;
      var height = typeof globalThis.innerHeight === "number"
        ? globalThis.innerHeight
        : 0;
      if (!width && el && el.clientWidth) width = el.clientWidth;
      if (!height && el && el.clientHeight) height = el.clientHeight;
      return { width: width, height: height };
    }

    function setPosition(left, top) {
      if (!button) return;
      button.style.left = left + "px";
      button.style.top = top + "px";
      button.style.right = "auto";
      button.style.bottom = "auto";
    }

    // 把记录的 left/top 应用回胶囊;越界时向内收,保证按钮始终可见。
    // 没有记录(首次注入)时默认停在页面左下角。
    function applyPosition(pos) {
      if (!button) return;
      if (!pos) {
        button.style.left = "20px";
        button.style.top = "auto";
        button.style.right = "auto";
        button.style.bottom = "20px";
        return;
      }
      var size = viewportSize();
      var width = button.offsetWidth || 0;
      var height = button.offsetHeight || 0;
      setPosition(
        clampNumber(pos.left, 0, Math.max(0, size.width - width)),
        clampNumber(pos.top, 0, Math.max(0, size.height - height)),
      );
    }

    function readStoredPosition() {
      try {
        var raw = sessionStorage.getItem(POS_KEY);
        if (!raw) return null;
        var pos = JSON.parse(raw);
        if (pos && typeof pos.left === "number" && typeof pos.top === "number" &&
          isFinite(pos.left) && isFinite(pos.top)) return pos;
      } catch (_) {}
      return null;
    }

    function storePosition(left, top) {
      try {
        sessionStorage.setItem(POS_KEY, JSON.stringify({
          left: Math.round(left),
          top: Math.round(top),
        }));
      } catch (_) {}
    }

    function onPointerDown(event) {
      if (!button || (event.button !== undefined && event.button !== 0)) return;
      var rect = button.getBoundingClientRect
        ? button.getBoundingClientRect()
        : { left: 0, top: 0 };
      dragState = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      };
      // 指针捕获:拖到胶囊之外也能继续收到 pointermove/pointerup。
      if (event.pointerId != null && button.setPointerCapture) {
        try { button.setPointerCapture(event.pointerId); } catch (_) {}
      }
    }

    function onPointerMove(event) {
      if (!dragState) return;
      if (event.pointerId != null && event.pointerId !== dragState.id) return;
      var dx = event.clientX - dragState.startX;
      var dy = event.clientY - dragState.startY;
      // 阈值内视为点击,避免手抖把点击当成拖拽。
      if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      dragState.moved = true;
      if (button) button.style.cursor = "grabbing";
      var size = viewportSize();
      var width = button ? (button.offsetWidth || 0) : 0;
      var height = button ? (button.offsetHeight || 0) : 0;
      setPosition(
        clampNumber(dragState.left + dx, 0, Math.max(0, size.width - width)),
        clampNumber(dragState.top + dy, 0, Math.max(0, size.height - height)),
      );
      if (event.preventDefault) event.preventDefault();
    }

    function onPointerUp(event) {
      if (!dragState) return;
      if (event.pointerId != null && event.pointerId !== dragState.id) return;
      var moved = dragState.moved;
      dragState = null;
      if (button) button.style.cursor = "pointer";
      if (event.pointerId != null && button && button.releasePointerCapture) {
        try { button.releasePointerCapture(event.pointerId); } catch (_) {}
      }
      if (!moved || !button) return;
      // 拖拽结束抑制随后的 click,避免误触录入/退出。
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
      if (button.getBoundingClientRect) {
        var rect = button.getBoundingClientRect();
        storePosition(rect.left, rect.top);
      }
    }

    function ensure() {
      if (button || !hostNode()) return;
      button = document.createElement("button");
      button.type = "button";
      button.title = "囤囤鼠脚本";
      button.style.cssText =
        "position:fixed;left:20px;bottom:20px;z-index:2147483647;" +
        "overflow:hidden;padding:10px 18px;border:none;border-radius:999px;" +
        "cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;" +
        "color:#fff;font:600 13px/1 system-ui,-apple-system," +
        "sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);";
      bar = document.createElement("div");
      bar.style.cssText =
        "position:absolute;left:0;top:0;bottom:0;width:0;z-index:0;" +
        "background:rgba(255,255,255,.4);transition:width .3s ease;";
      label = document.createElement("span");
      label.style.cssText = "position:relative;z-index:1;";
      button.appendChild(bar);
      button.appendChild(label);
      button.addEventListener("click", onClick);
      button.addEventListener("pointerdown", onPointerDown);
      button.addEventListener("pointermove", onPointerMove);
      button.addEventListener("pointerup", onPointerUp);
      button.addEventListener("pointercancel", onPointerUp);
      hostNode().appendChild(button);
      applyPosition(readStoredPosition());
      paint();
    }

    function paint() {
      ensure();
      if (!button) return;
      if (mode === "hidden") {
        button.style.display = "none";
        return;
      }
      button.style.display = "";
      button.disabled = mode === "busy";
      if (mode === "idle") {
        label.textContent = "快捷录入";
        button.style.background = "#0a83c4";
        bar.style.width = "0%";
      } else if (mode === "active") {
        label.textContent = "免登中（" + activeName + "）";
        button.title = "囤囤鼠 PAT 免登 · " + activeName +
          (location.protocol === "http:" ? " · HTTP 明文传输" : "");
        button.style.background = "#16a34a";
        bar.style.width = "0%";
      } else if (mode === "failed") {
        label.textContent = "免登失败";
        button.style.background = "#dc2626";
        bar.style.width = "0%";
      } else {
        // busy: 文案与进度条由 progress() 接管。
        button.style.background = "#0a83c4";
      }
    }

    function onClick() {
      // 刚完成拖拽的 pointerup 会紧跟一次 click,这里直接吞掉。
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (mode === "active") {
        if (!confirm(
          "退出免登状态?退出后将以当前账号重新登录上游," +
            "Session、2FA、Passkey、Playground 等真实登录功能恢复可用。",
        )) return;
        var runExit = exitHandler;
        exitHandler = null;
        mode = "busy";
        if (label) label.textContent = "退出登录态…";
        if (bar) bar.style.width = "10%";
        if (button) {
          button.disabled = true;
          button.style.background = "#0a83c4";
        }
        if (runExit) runExit();
        return;
      }
      if (mode === "idle" && idleHandler) idleHandler();
    }

    return {
      // 免登 runtime 校验通过:展示「免登中(用户名)」,点击回调 exitLogin。
      activate: function (user, onExit) {
        activeName = user && user.username
          ? String(user.username)
          : String((user && user.id) || "");
        exitHandler = onExit || null;
        mode = "active";
        paint();
      },
      // 免登前置流程 / 快捷录入共用的分步进度。
      progress: function (text, pct) {
        mode = "busy";
        ensure();
        if (label) label.textContent = text;
        if (bar) bar.style.width = (Number(pct) || 0) + "%";
        if (button) {
          button.disabled = true;
          button.style.display = "";
          button.style.background = "#0a83c4";
        }
      },
      fail: function (text) {
        mode = "failed";
        ensure();
        if (label) label.textContent = "免登失败";
        if (button) {
          button.style.display = "";
          button.title = text ? String(text) : "囤囤鼠脚本";
        }
      },
      // 识别到 new-api 且未进入免登:展示「快捷录入」。仅免登(active)优先;
      // busy 既可能是免登前置,也可能是快捷录入自身,故允许 busy 转回 idle。
      showIdle: function () {
        if (mode === "active") return;
        mode = "idle";
        paint();
      },
      hide: function () {
        if (mode === "active" || mode === "busy") return;
        mode = "hidden";
        paint();
      },
      isActive: function () {
        return mode === "active";
      },
      // active 或 busy 时快捷录入必须让位(免登优先)。
      engaged: function () {
        return mode === "active" || mode === "busy";
      },
      idleClick: function (handler) {
        idleHandler = handler;
      },
    };
  })();

${buildUpstreamLoginRuntimeSource()}

  function toast(msg, ok) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText =
      "position:fixed;left:50%;bottom:84px;transform:translateX(-50%);" +
      "z-index:2147483647;padding:10px 16px;border-radius:8px;color:#fff;" +
      "font:13px/1.4 system-ui,-apple-system,sans-serif;max-width:80vw;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.25);background:" +
      (ok ? "#16a34a" : "#dc2626") + ";";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  // 跨域调囤囤鼠 API:带 Bearer 鉴权,Promise 化返回 {status, json}。
  function tts(method, path, body) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: method,
        url: TTS_BASE + path,
        headers: {
          "Authorization": "Bearer " + TTS_KEY,
          "Content-Type": "application/json",
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 15000,
        onload: function (res) {
          var json = null;
          try { json = JSON.parse(res.responseText); } catch (e) {}
          resolve({ status: res.status, json: json });
        },
        onerror: function () { reject(new Error("网络错误:无法连接囤囤鼠")); },
        ontimeout: function () { reject(new Error("请求超时")); },
      });
    });
  }

  function normOrigin(o) { return String(o || "").replace(/[/]+$/, ""); }

  // 旧版 new-api 会把完整用户对象放在 localStorage.user。仅接受正整数 id,
  // 避免损坏/无关数据阻止新版鉴权兜底。
  function getLegacyUser() {
    try {
      var user = JSON.parse(localStorage.getItem("user") || "null");
      var id = user && Number(user.id);
      return Number.isInteger(id) && id > 0 ? user : null;
    } catch (e) {
      return null;
    }
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function taggedError(message, kind) {
    var error = new Error(message);
    error.kind = kind;
    return error;
  }

  function responseMessage(json, fallback) {
    var message = json && (json.message || json.error);
    return message ? String(message) : fallback;
  }

  // new-api 甄别:/api/status 命中 >=2 个特征字段才认。
  function detectNewApi() {
    return fetch("/api/status", { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) {
        if (!b) return false;
        var d = b.data || b;
        if (!d || typeof d !== "object") return false;
        var hits = 0;
        if (d.system_name !== undefined) hits++;
        if (d.version !== undefined) hits++;
        if (d.start_time !== undefined) hits++;
        if (d.quota_per_unit !== undefined) hits++;
        return hits >= 2;
      })
      .catch(function () { return false; });
  }

  var recorded = false;
  var quickBusy = false;

  function expectTtsPage(r, what) {
    if (r.status === 401) {
      throw new Error("鉴权失败,请从囤囤鼠后台重新安装脚本");
    }
    var page = r.json;
    if (r.status < 200 || r.status >= 300 || !page ||
      !Array.isArray(page.items) || !Number.isInteger(Number(page.pageSize)) ||
      Number(page.pageSize) < 1 || !Number.isInteger(Number(page.pageIndex)) ||
      Number(page.pageIndex) < 1 || !Number.isFinite(Number(page.totalCount)) ||
      Number(page.totalCount) < 0) {
      throw new Error(responseMessage(r.json, what + "失败(" + r.status + ")"));
    }
    return {
      items: page.items,
      pageSize: Number(page.pageSize),
      pageIndex: Number(page.pageIndex),
      totalCount: Number(page.totalCount),
    };
  }

  // 后台列表 API 是分页接口。搜索词先缩小候选集,随后逐页精确匹配,避免目标记录
  // 不在第一页时误判为“未录入”并绕过覆盖确认。
  function findTtsItem(path, params, what, predicate, pageIndex) {
    var search = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      search.set(key, String(params[key]));
    });
    search.set("pageSize", "50");
    search.set("pageIndex", String(pageIndex));
    return tts("GET", path + "?" + search.toString()).then(function (r) {
      var page = expectTtsPage(r, what);
      var found = page.items.find(predicate);
      if (found) return found;
      if (page.items.length === 0 ||
        page.pageIndex * page.pageSize >= page.totalCount) return null;
      return findTtsItem(path, params, what, predicate, pageIndex + 1);
    });
  }

  // 已录入判定:站点(origin) 与账号(site_id+user_id) 都存在则 recorded。
  // 返回 Promise<boolean>,点击流程会等待结果后再决定是否弹出覆盖确认。
  function refreshRecorded(auth) {
    if (!auth || !auth.userId) {
      recorded = false;
      return Promise.resolve(false);
    }
    var origin = normOrigin(location.origin);
    return findTtsItem(
      "/api/sites",
      { siteQ: origin },
      "读取站点",
      function (s) {
        return s && s.id != null && normOrigin(s.origin) === origin;
      },
      1,
    ).then(function (site) {
      if (!site) return false;
      return findTtsItem(
        "/api/accounts",
        { siteId: site.id, accountQ: auth.userId },
        "读取账号",
        function (a) {
          return String(a.site_id) === String(site.id) &&
            String(a.user_id) === String(auth.userId);
        },
        1,
      ).then(function (account) { return !!account; });
    }).then(function (found) {
      recorded = !!found;
      return recorded;
    });
  }

  // 同源调 new-api。旧模式只带 session cookie + New-Api-User;新版模式额外带
  // 短期 Dashboard Bearer token。返回 HTTP 状态与解析后的 JSON,供鉴权分支判断。
  function napiRequest(method, path, auth, body) {
    var headers = {
      "Cache-Control": "no-store",
      "New-Api-User": String(auth.userId),
    };
    if (auth.dashboardToken) {
      headers.Authorization = "Bearer " + auth.dashboardToken;
    }
    if (body) headers["Content-Type"] = "application/json";
    return fetch(path, {
      method: method,
      credentials: "include",
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (json) {
        return { status: r.status, json: json };
      });
    }, function (e) {
      throw new Error("连接 new-api 失败:" + ((e && e.message) || "网络错误"));
    });
  }

  function napi(method, path, auth, body) {
    return napiRequest(method, path, auth, body).then(function (r) {
      return r.json;
    });
  }

  // 验证旧 localStorage 用户确实仍有有效 session。最新版不接受这组凭据时返回 401,
  // 此时才允许切换到 refresh 鉴权;普通服务错误不误触发模式切换。
  function validateLegacyAuth(user) {
    var auth = {
      mode: "legacy",
      userId: String(user.id),
      user: user,
      dashboardToken: null,
      accessExpiresAt: null,
    };
    return napiRequest("GET", "/api/user/self", auth).then(function (r) {
      if (r.status === 401) {
        throw taggedError("旧版登录状态已失效", "legacy_unauthorized");
      }
      if (r.status < 200 || r.status >= 300) {
        throw new Error(responseMessage(
          r.json,
          "验证旧版登录状态失败(" + r.status + ")",
        ));
      }
      var current = r.json && r.json.success === true && r.json.data;
      if (!current || current.id == null) {
        throw new Error(responseMessage(r.json, "验证旧版登录状态失败"));
      }
      if (String(current.id) !== String(user.id)) {
        throw taggedError("旧版登录用户已变化", "legacy_unauthorized");
      }
      auth.user = current;
      return auth;
    });
  }

  var refreshRaceDelays = [80, 200, 500];

  function refreshModernAttempt(attempt) {
    return fetch("/api/user/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Cache-Control": "no-store" },
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (json) {
        return { status: r.status, json: json };
      });
    }, function (e) {
      throw new Error("连接 new-api 失败:" + ((e && e.message) || "网络错误"));
    }).then(function (r) {
      var code = r.json && r.json.code;
      if (r.status === 409 && code === "AUTH_REFRESH_RACE" &&
        attempt < refreshRaceDelays.length) {
        return wait(refreshRaceDelays[attempt]).then(function () {
          return refreshModernAttempt(attempt + 1);
        });
      }
      if (r.status === 401 || r.status === 404 || r.status === 405) {
        throw taggedError("请先登录 new-api", "not_logged_in");
      }
      if (r.status === 429) {
        throw new Error("new-api 登录校验请求过于频繁,请稍后重试");
      }
      if (r.status < 200 || r.status >= 300) {
        throw new Error(responseMessage(
          r.json,
          "验证新版登录状态失败(" + r.status + ")",
        ));
      }
      var data = r.json && r.json.success === true && r.json.data;
      var user = data && data.user;
      var expiresAt = data && Number(data.access_expires_at);
      if (!user || !Number.isInteger(Number(user.id)) || Number(user.id) <= 0 ||
        !data.access_token || !Number.isFinite(expiresAt) || expiresAt <= 0) {
        throw new Error("new-api 返回了无效的登录状态");
      }
      return {
        mode: "modern",
        userId: String(user.id),
        user: user,
        dashboardToken: String(data.access_token),
        accessExpiresAt: expiresAt,
      };
    });
  }

  function refreshModernAuth() {
    var run = function () { return refreshModernAttempt(0); };
    if (typeof navigator !== "undefined" && navigator.locks &&
      typeof navigator.locks.request === "function") {
      return navigator.locks.request("new-api:auth-refresh", run);
    }
    return run();
  }

  // 鉴权顺序是有意的:有效的旧版 localStorage + session 永远优先;只有取不到或
  // 明确验证失效时才访问新版 refresh 端点。
  function resolveAuth() {
    var legacyUser = getLegacyUser();
    if (!legacyUser) return refreshModernAuth();
    return validateLegacyAuth(legacyUser).catch(function (e) {
      if (e && e.kind === "legacy_unauthorized") return refreshModernAuth();
      throw e;
    });
  }

  // 生成长期 PAT(每次生成都会令旧 PAT 失效)。新版 Dashboard token 只用于鉴权
  // 本次同源请求,真正交给囤囤鼠保存的是响应 data 中的 PAT。
  function genAccessToken(auth) {
    return napiRequest("GET", "/api/user/token", auth).then(function (r) {
      if (r.status === 401) {
        throw taggedError("登录状态已失效,请重试", "not_logged_in");
      }
      var token = r.json && r.json.success === true && r.json.data;
      if (r.status < 200 || r.status >= 300 ||
        typeof token !== "string" || !token.trim()) {
        throw new Error(responseMessage(r.json, "获取 accessToken 失败"));
      }
      return token.trim();
    });
  }

  // 确保该用户在 new-api 下至少有 1 个 APIKey;没有则按可用分组各建一个无限额度 DEFAULT 密钥。
  // 尽力而为:任何环节失败只 console.warn,不抛错(不阻断账号保存)。
  function ensureApiKeys(auth) {
    return napi("GET", "/api/token/?p=1&page_size=10", auth).then(function (j) {
      var data = j && j.data;
      var total = data && typeof data.total === "number"
        ? data.total
        : (data && Array.isArray(data.items) ? data.items.length : 0);
      if (total >= 1) return; // 已有现成密钥 → 走正常逻辑,不创建
      // 无密钥:取可用分组,逐个创建。
      return napi("GET", "/api/user/self/groups", auth).then(function (g) {
        var groups = (g && g.data && typeof g.data === "object")
          ? Object.keys(g.data)
          : [];
        if (!groups.length) groups = [""]; // 无分组信息时退回默认空分组(用用户默认分组)
        // 串行创建,便于逐个容错。
        return groups.reduce(function (p, name) {
          return p.then(function () {
            return napi("POST", "/api/token/", auth, {
              name: ("DEFAULT - " + (name || "default")).slice(0, 50), // new-api 名称上限 50
              unlimited_quota: true, // 无限额度
              remain_quota: 0, // 无限时忽略
              expired_time: -1, // 永不过期:0 会被 new-api 当作已过期
              group: name,
            }).then(function (res) {
              if (!res || !res.success) {
                console.warn(
                  "[囤囤鼠] 创建密钥失败:" + name,
                  res && res.message,
                );
              }
            });
          });
        }, Promise.resolve());
      });
    }).catch(function (e) {
      console.warn("[囤囤鼠] 检查/创建密钥失败", e);
    });
  }

  // 校验囤囤鼠响应:优先把后端的 error/message 透出到 toast。
  function checkStatus(r, what) {
    if (r.status === 401) {
      throw new Error("鉴权失败,请从囤囤鼠后台重新安装脚本");
    }
    var detail = r.json && (r.json.error || r.json.message);
    if (r.status < 200 || r.status >= 300 || !r.json || r.json.id == null) {
      throw new Error(
        detail ? (what + "失败:" + detail) : (what + "失败(" + r.status + ")"),
      );
    }
    return r.json;
  }

  // 保存成功后,调囤囤鼠账号签到接口(POST /api/accounts/:id/checkin)签到一次,
  // 顺带验证保存的令牌可用。返回展示文案:签到成功 / 签到需验证 / 签到失败(尽量带原因)。
  // 失败原因优先级:后端归一化 message(checkinAccount)→ 异常 error → HTTP 状态。
  // 尽力而为:任何失败都归一化为文案并 resolve,不 reject(不影响录入成功结果)。
  function tryCheckin(accountId) {
    return tts("POST", "/api/accounts/" + accountId + "/checkin")
      .then(function (r) {
        var j = r.json;
        if (r.status >= 200 && r.status < 300 && j) {
          if (j.ok) return "签到成功";
          if (j.checkinStatus === "manual_required") return "签到需验证";
        }
        var reason = (j && (j.message || j.error)) || "";
        if (!reason && (r.status < 200 || r.status >= 300)) {
          reason = "HTTP " + r.status;
        }
        reason = reason ? String(reason).slice(0, 80) : "";
        return reason ? ("签到失败:" + reason) : "签到失败";
      })
      .catch(function () { return "签到失败"; });
  }

  function runQuickEntry() {
    if (quickBusy) return;
    var auth = null;
    var wasRecorded = false;
    var origin = normOrigin(location.origin);
    var siteId = null;
    var accessToken = null;
    quickBusy = true;
    // 1.解析并验证当前用户 → 2.确认覆盖 → 3.保存站点 → 4.取 PAT →
    // 5.确保 APIKey → 6.保存账号(均 upsert) → 7.签到一次。
    TTS_UPSTREAM_UI.progress("验证登录…", 5);
    resolveAuth().then(function (resolved) {
      auth = resolved;
      return refreshRecorded(auth);
    }).then(function (found) {
      wasRecorded = found;
      if (found && !confirm(
        "该账号已录入。重新保存会重新生成 new-api access token" +
          "(旧 token 立即失效)并覆盖已有记录,确定继续?",
      )) {
        throw taggedError("", "cancelled");
      }
      TTS_UPSTREAM_UI.progress("保存站点…", 15);
      return tts("POST", "/api/sites", { origin: origin });
    }).then(function (r) {
      siteId = checkStatus(r, "保存站点").id;
      TTS_UPSTREAM_UI.progress("获取令牌…", 40);
      return genAccessToken(auth);
    }).then(function (token) {
      accessToken = token;
      // 保存账号前确保至少 1 个 APIKey(尽力而为,内部已吞错,失败不阻断保存)。
      TTS_UPSTREAM_UI.progress("检查密钥…", 62);
      return ensureApiKeys(auth);
    }).then(function () {
      TTS_UPSTREAM_UI.progress("保存账号…", 80);
      return tts("POST", "/api/accounts", {
        siteId: Number(siteId),
        userId: String(auth.userId),
        accessToken: accessToken,
      });
    }).then(function (r) {
      var accountId = checkStatus(r, "保存账号").id;
      recorded = true;
      // 保存成功后顺带签到一次(尽力而为,不改变录入成功结果)。
      TTS_UPSTREAM_UI.progress("签到中…", 90);
      return tryCheckin(accountId);
    }).then(function (note) {
      TTS_UPSTREAM_UI.progress("完成", 100);
      var base = wasRecorded ? "已更新" : "已录入";
      toast(note ? (base + " · " + note) : base, true);
      setTimeout(function () {
        quickBusy = false;
        TTS_UPSTREAM_UI.showIdle();
      }, 450);
    }).catch(function (e) {
      quickBusy = false;
      TTS_UPSTREAM_UI.showIdle();
      if (e && e.kind === "cancelled") return;
      toast((e && e.message) ? e.message : "录入失败", false);
    });
  }

  function init() {
    // 免登(active)或免登前置流程(busy)优先,快捷录入让位。
    if (TTS_UPSTREAM_UI.engaged()) return;
    detectNewApi().then(function (ok) {
      if (!ok || !document.body || TTS_UPSTREAM_UI.engaged()) return;
      TTS_UPSTREAM_UI.idleClick(runQuickEntry);
      TTS_UPSTREAM_UI.showIdle();
      resolveAuth().then(function (auth) {
        return refreshRecorded(auth);
      }).catch(function () {
        recorded = false;
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
`;
}
