/**
 * 生成「囤囤鼠 · 快捷录入」油猴脚本(Tampermonkey/Violentmonkey)。
 *
 * baseUrl 与 authKey 在安装时随链接注入:
 * - 二者用 JSON.stringify 注入为 JS 字符串字面量,防止引号截断脚本(注入安全的关键);
 * - 元数据里的 @connect / @updateURL / @downloadURL 用 hostname / encodeURIComponent 处理;
 * - 浏览器侧代码全程不用模板字符串(避免与本模板自身的 ${} 冲突),正则用 [/] 规避反斜杠。
 *
 * 脚本逻辑:在任意页面用 /api/status 甄别 new-api → 渲染右下角悬浮按钮(带进度条) →
 * 跨域(GM_xmlhttpRequest)查囤囤鼠是否已录入 → 一键保存站点 + 取 token →
 * 保存账号前确保至少 1 个 APIKey(无则按分组各建一个无限额度的 DEFAULT 密钥)→ 保存账号
 * → 调囤囤鼠签到接口签到一次(顺带验证令牌可用);
 * 已录入态点击需 confirm 确认后重新保存(后端 POST 已是 upsert,新建/重存同一链路)。
 *
 * new-api 的 UserAuth 中间件要求每个鉴权请求都带 New-Api-User 头(= 登录用户 id),
 * 故 /api/user/token 必须带该头,否则报「未提供 New-Api-User」。
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
// @version      1.3.1
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
  var prog = null;
  var lbl = null;
  var state = { recorded: false, busy: false };

  function render() {
    btn = document.createElement("button");
    btn.type = "button";
    btn.title = "囤囤鼠 · 快捷录入";
    btn.style.cssText =
      "position:fixed;right:20px;bottom:20px;z-index:2147483647;overflow:hidden;" +
      "padding:10px 18px;border:none;border-radius:999px;cursor:pointer;" +
      "color:#fff;font:600 13px/1 system-ui,-apple-system,sans-serif;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.25);";
    // 进度条背景:录入过程中从左往右填充。
    prog = document.createElement("div");
    prog.style.cssText =
      "position:absolute;left:0;top:0;bottom:0;width:0;z-index:0;" +
      "background:rgba(255,255,255,.4);transition:width .3s ease;";
    lbl = document.createElement("span");
    lbl.style.cssText = "position:relative;z-index:1;";
    btn.appendChild(prog);
    btn.appendChild(lbl);
    btn.addEventListener("click", onClick);
    document.body.appendChild(btn);
    paint();
  }

  // 进行中:更新文案与进度条(0-100)。
  function step(label, pct) {
    if (lbl) lbl.textContent = label;
    if (prog) prog.style.width = pct + "%";
  }

  // 空闲态:复位进度条,按 recorded 设定文案与底色。进行中由 step() 接管。
  function paint() {
    if (!btn) return;
    btn.disabled = state.busy;
    if (state.busy) return;
    prog.style.width = "0%";
    if (state.recorded) {
      lbl.textContent = "已录入";
      btn.style.background = "#16a34a";
    } else {
      lbl.textContent = "一键录入";
      btn.style.background = "#0a83c4";
    }
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
  // new-api 要求带 New-Api-User 头(= 登录用户 id),否则报「未提供 New-Api-User」。
  function genAccessToken(userId) {
    return fetch("/api/user/token", {
      credentials: "include",
      headers: { "New-Api-User": String(userId) },
    })
      .then(function (r) {
        return r.json().catch(function () { return null; });
      })
      .then(function (j) {
        if (!j || !j.data) {
          throw new Error(
            (j && j.message) || "获取 accessToken 失败,请确认已登录 new-api",
          );
        }
        return j.data;
      });
  }

  // 同源调 new-api 用户接口:带 session cookie 与 New-Api-User 头,返回解析后 JSON(失败返回 null)。
  // 与 genAccessToken 一致——脚本运行在 new-api 页面上下文,token 接口为同源,用 fetch 而非跨域。
  function napi(method, path, userId, body) {
    return fetch(path, {
      method: method,
      credentials: "include",
      headers: {
        "New-Api-User": String(userId),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    });
  }

  // 确保该用户在 new-api 下至少有 1 个 APIKey;没有则按可用分组各建一个无限额度 DEFAULT 密钥。
  // 尽力而为:任何环节失败只 console.warn,不抛错(不阻断账号保存)。
  function ensureApiKeys(userId) {
    return napi("GET", "/api/token/?p=1&page_size=10", userId).then(function (j) {
      var data = j && j.data;
      var total = data && typeof data.total === "number"
        ? data.total
        : (data && Array.isArray(data.items) ? data.items.length : 0);
      if (total >= 1) return; // 已有现成密钥 → 走正常逻辑,不创建
      // 无密钥:取可用分组,逐个创建。
      return napi("GET", "/api/user/self/groups", userId).then(function (g) {
        var groups = (g && g.data && typeof g.data === "object")
          ? Object.keys(g.data)
          : [];
        if (!groups.length) groups = [""]; // 无分组信息时退回默认空分组(用用户默认分组)
        // 串行创建,便于逐个容错。
        return groups.reduce(function (p, name) {
          return p.then(function () {
            return napi("POST", "/api/token/", userId, {
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
      throw new Error("鉴权失败,请从囤囤鼠后台「快捷录入」重新安装脚本");
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
    var accessToken = null;
    state.busy = true;
    btn.disabled = true;
    btn.style.background = "#0a83c4";
    // 1.保存站点 → 2.取 token → 3.确保 APIKey → 4.保存账号(均 upsert) → 5.签到一次。
    step("保存站点…", 10);
    tts("POST", "/api/sites", { origin: origin }).then(function (r) {
      siteId = checkStatus(r, "保存站点").id;
      step("获取令牌…", 35);
      return genAccessToken(user.id);
    }).then(function (token) {
      accessToken = token;
      // 保存账号前确保至少 1 个 APIKey(尽力而为,内部已吞错,失败不阻断保存)。
      step("检查密钥…", 60);
      return ensureApiKeys(user.id);
    }).then(function () {
      step("保存账号…", 78);
      return tts("POST", "/api/accounts", {
        siteId: Number(siteId),
        userId: String(user.id),
        accessToken: accessToken,
      });
    }).then(function (r) {
      var accountId = checkStatus(r, "保存账号").id;
      state.recorded = true;
      // 保存成功后顺带签到一次(尽力而为,不改变录入成功结果)。
      step("签到中…", 90);
      return tryCheckin(accountId);
    }).then(function (note) {
      step("完成", 100);
      var base = wasRecorded ? "已更新" : "已录入";
      toast(note ? (base + " · " + note) : base, true);
      setTimeout(function () { state.busy = false; paint(); }, 450);
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
