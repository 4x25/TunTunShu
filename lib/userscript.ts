/**
 * 生成「囤囤鼠 · 快捷录入」油猴脚本(Tampermonkey/Violentmonkey)。
 *
 * baseUrl 与 authKey 在安装时随链接注入:
 * - 二者用 JSON.stringify 注入为 JS 字符串字面量,防止引号截断脚本(注入安全的关键);
 * - 元数据里的 @connect / @updateURL / @downloadURL 用 hostname / encodeURIComponent 处理;
 * - 浏览器侧代码全程不用模板字符串(避免与本模板自身的 ${} 冲突),正则用 [/] 规避反斜杠。
 *
 * 脚本逻辑:在任意页面用 /api/status 甄别 new-api → 渲染右下角悬浮按钮 →
 * 跨域(GM_xmlhttpRequest)查囤囤鼠是否已录入 → 一键保存站点 + 取 token + 保存账号;
 * 已录入态点击需 confirm 确认后重新保存(后端 POST 已是 upsert,新建/重存同一链路)。
 */
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
// @name         囤囤鼠 · 快捷录入
// @namespace    tuntunshu
// @version      1.0.0
// @description  在 new-api 站点一键录入站点与账号到囤囤鼠
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      ${host}
// @updateURL    ${installUrl}
// @downloadURL  ${installUrl}
// @run-at       document-idle
// @noframes
// ==/UserScript==
(function () {
  "use strict";
  var TTS_BASE = ${baseLit};
  var TTS_KEY = ${keyLit};

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
    setTimeout(function () { t.remove(); }, 3200);
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

  function getUser() {
    try { return JSON.parse(localStorage.getItem("user") || "null"); }
    catch (e) { return null; }
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

  var btn = null;
  var state = { recorded: false, busy: false };

  function paint() {
    if (!btn) return;
    if (state.busy) {
      btn.textContent = "处理中…";
      btn.style.background = "#6b7280";
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    if (state.recorded) {
      btn.textContent = "已录入";
      btn.style.background = "#16a34a";
    } else {
      btn.textContent = "一键录入";
      btn.style.background = "#0a83c4";
    }
  }

  function render() {
    btn = document.createElement("button");
    btn.type = "button";
    btn.title = "囤囤鼠 · 快捷录入";
    btn.style.cssText =
      "position:fixed;right:20px;bottom:20px;z-index:2147483647;" +
      "padding:10px 18px;border:none;border-radius:999px;cursor:pointer;" +
      "color:#fff;font:600 13px/1 system-ui,-apple-system,sans-serif;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.25);";
    btn.addEventListener("click", onClick);
    document.body.appendChild(btn);
    paint();
  }

  // 已录入判定:站点(origin) 与账号(site_id+user_id) 都存在则 recorded。
  function refreshRecorded(user) {
    if (!user || user.id == null) { state.recorded = false; paint(); return; }
    var origin = normOrigin(location.origin);
    tts("GET", "/api/sites").then(function (r) {
      var sites = Array.isArray(r.json) ? r.json : [];
      var site = sites.find(function (s) {
        return normOrigin(s.origin) === origin;
      });
      if (!site) return null;
      return tts("GET", "/api/accounts").then(function (r2) {
        var accts = Array.isArray(r2.json) ? r2.json : [];
        return accts.find(function (a) {
          return String(a.site_id) === String(site.id) &&
            String(a.user_id) === String(user.id);
        }) || null;
      });
    }).then(function (acct) {
      state.recorded = !!acct;
      paint();
    }).catch(function () {});
  }

  // 同源取 access token(每次生成新 token,旧的失效)。
  function genAccessToken() {
    return fetch("/api/user/token", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var tok = j && j.data;
        if (!tok) throw new Error("获取 accessToken 失败,请确认已登录 new-api");
        return tok;
      });
  }

  function checkStatus(r, what) {
    if (r.status === 401) {
      throw new Error("鉴权失败,请从囤囤鼠后台「快捷录入」重新安装脚本");
    }
    if (r.status < 200 || r.status >= 300 || !r.json || r.json.id == null) {
      throw new Error(what + "失败(" + r.status + ")");
    }
    return r.json;
  }

  function onClick() {
    if (state.busy) return;
    var user = getUser();
    if (!user || user.id == null) { toast("请先登录 new-api", false); return; }
    if (state.recorded) {
      if (!confirm("该账号已录入。重新保存会重新生成 new-api access token" +
        "(旧 token 立即失效)并覆盖已有记录,确定继续?")) return;
    }
    var wasRecorded = state.recorded;
    var origin = normOrigin(location.origin);
    var siteId = null;
    state.busy = true; paint();
    // 1.保存站点(upsert) → 2.取 token → 3.保存账号(upsert)
    tts("POST", "/api/sites", { origin: origin }).then(function (r) {
      siteId = checkStatus(r, "保存站点").id;
      return genAccessToken();
    }).then(function (token) {
      return tts("POST", "/api/accounts", {
        siteId: Number(siteId),
        userId: String(user.id),
        accessToken: token,
      });
    }).then(function (r) {
      checkStatus(r, "保存账号");
      state.recorded = true;
      state.busy = false;
      paint();
      toast(wasRecorded ? "已更新凭证" : "录入成功", true);
    }).catch(function (e) {
      state.busy = false;
      paint();
      toast((e && e.message) ? e.message : "录入失败", false);
    });
  }

  function init() {
    detectNewApi().then(function (ok) {
      if (!ok || !document.body) return;
      render();
      refreshRecorded(getUser());
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
