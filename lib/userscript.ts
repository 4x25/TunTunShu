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
export const TUNTUNSHU_SCRIPT_VERSION = "2.1.0";

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

  // ── 新版 new-api 的 scoped access token 参数 ────────────────────────
  // 权限为完整个人域(不含 account_security:write);过期时间 0 = 永不过期,
  // 与旧版单 PAT 的行为对齐;固定名称便于用户在上游「安全」页辨认。
  var PAT_NAME = "囤囤鼠";
  var PAT_SCOPES = [
    "profile:read",
    "profile:write",
    "api_key:read",
    "api_key:write",
    "api_key:reveal",
    "wallet:read",
    "wallet:write",
    "usage:read",
    "account_security:read",
  ];
  var PAT_EXPIRES_AT = 0;
  var ACCESS_TOKEN_SCOPE = "access_token.generate";
  var PASSWORD_SET_SCOPE = "account.password.set";
  // OAuth 弹窗的等待上限与轮询间隔(同时承担「用户关窗」检测)。
  var OAUTH_POPUP_DEADLINE_MS = 10 * 60 * 1000;
  var OAUTH_POPUP_POLL_MS = 500;

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

  // ── 安全验证弹窗:密码 / 2FA 动态码 / 设置密码 / 手动粘贴 ──────────
  // opts.action(values) 返回 Promise:
  //   {done:true, value} → 关闭弹窗并 resolve(value);
  //   {error}            → 展示错误并保留弹窗(允许重试);
  //   抛出的异常同样按错误展示。取消/关闭 → resolve(null)。
  function ttsDialog(opts) {
    return new Promise(function (resolve) {
      if (!document.body) {
        resolve(null);
        return;
      }
      var overlay = document.createElement("div");
      overlay.id = "tts-dialog";
      overlay.style.cssText =
        "position:fixed;inset:0;left:0;top:0;right:0;bottom:0;" +
        "z-index:2147483647;background:rgba(15,23,42,.55);" +
        "display:flex;align-items:center;justify-content:center;padding:16px;";
      var box = document.createElement("div");
      box.style.cssText =
        "width:100%;max-width:400px;max-height:86vh;overflow:auto;background:#fff;" +
        "color:#0f172a;border-radius:12px;padding:18px;" +
        "box-shadow:0 20px 50px rgba(0,0,0,.35);" +
        "font:13px/1.6 system-ui,-apple-system,sans-serif;text-align:left;";
      var title = document.createElement("div");
      title.textContent = opts.title || "安全验证";
      title.style.cssText = "font-size:15px;font-weight:700;margin-bottom:6px;";
      box.appendChild(title);
      if (opts.desc) {
        var desc = document.createElement("div");
        desc.textContent = String(opts.desc);
        desc.style.cssText =
          "color:#334155;margin-bottom:10px;white-space:pre-line;";
        box.appendChild(desc);
      }
      if (opts.link && opts.link.href) {
        var link = document.createElement("a");
        link.href = String(opts.link.href);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = opts.link.label ? String(opts.link.label) : "打开链接";
        link.style.cssText =
          "display:inline-block;color:#0a83c4;margin-bottom:10px;";
        box.appendChild(link);
      }
      var select = null;
      if (opts.select && opts.select.options && opts.select.options.length > 1) {
        var selectLabel = document.createElement("div");
        selectLabel.textContent = opts.select.label
          ? String(opts.select.label)
          : "选择授权方式";
        selectLabel.style.cssText = "margin:6px 0 4px;color:#334155;";
        box.appendChild(selectLabel);
        select = document.createElement("select");
        select.id = "tts-dialog-select";
        select.style.cssText =
          "width:100%;box-sizing:border-box;padding:8px;border:1px solid #cbd5e1;" +
          "border-radius:8px;background:#fff;color:#0f172a;font:inherit;";
        for (var i = 0; i < opts.select.options.length; i++) {
          var option = document.createElement("option");
          option.value = String(opts.select.options[i].value);
          option.textContent = String(
            opts.select.options[i].label || opts.select.options[i].value,
          );
          select.appendChild(option);
        }
        box.appendChild(select);
      }
      var input = null;
      if (opts.input) {
        var inputLabel = document.createElement("div");
        inputLabel.textContent = opts.input.label ? String(opts.input.label) : "";
        inputLabel.style.cssText = "margin:6px 0 4px;color:#334155;";
        box.appendChild(inputLabel);
        input = document.createElement("input");
        input.id = "tts-dialog-input";
        input.type = opts.input.type === "password" ? "password" : "text";
        input.value = opts.input.value != null ? String(opts.input.value) : "";
        if (opts.input.placeholder) {
          input.placeholder = String(opts.input.placeholder);
        }
        input.autocomplete = "off";
        input.style.cssText =
          "width:100%;box-sizing:border-box;padding:9px 10px;" +
          "border:1px solid #cbd5e1;border-radius:8px;background:#fff;" +
          "color:#0f172a;font:inherit;outline:none;";
        box.appendChild(input);
      }
      if (opts.note) {
        var note = document.createElement("div");
        note.textContent = String(opts.note);
        note.style.cssText =
          "margin-top:8px;color:#64748b;font-size:12px;white-space:pre-line;";
        box.appendChild(note);
      }
      var error = document.createElement("div");
      error.id = "tts-dialog-error";
      error.textContent = opts.error ? String(opts.error) : "";
      error.style.cssText =
        "margin-top:8px;color:#dc2626;font-size:12px;min-height:0;";
      box.appendChild(error);
      var actions = document.createElement("div");
      actions.style.cssText =
        "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;";
      var cancel = document.createElement("button");
      cancel.id = "tts-dialog-cancel";
      cancel.type = "button";
      cancel.textContent = "取消";
      cancel.style.cssText =
        "padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;" +
        "background:#fff;color:#334155;cursor:pointer;" +
        "font:600 13px/1 system-ui,-apple-system,sans-serif;";
      var submit = document.createElement("button");
      submit.id = "tts-dialog-submit";
      submit.type = "button";
      submit.textContent = opts.submitText ? String(opts.submitText) : "确定";
      submit.style.cssText =
        "padding:8px 14px;border:none;border-radius:8px;background:#0a83c4;" +
        "color:#fff;cursor:pointer;font:600 13px/1 system-ui,-apple-system,sans-serif;";
      actions.appendChild(cancel);
      actions.appendChild(submit);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      var busy = false;
      var settled = false;
      function close(value) {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch (_) {
          if (overlay.parentNode && overlay.parentNode.removeChild) {
            overlay.parentNode.removeChild(overlay);
          }
        }
        resolve(value);
      }
      function setBusy(next) {
        busy = next;
        cancel.disabled = next;
        submit.disabled = next;
        submit.textContent = next
          ? "处理中…"
          : (opts.submitText ? String(opts.submitText) : "确定");
      }
      function submitValues() {
        if (busy || settled) return;
        error.textContent = "";
        var values = {
          input: input ? String(input.value) : "",
          select: select ? String(select.value) : "",
        };
        setBusy(true);
        Promise.resolve().then(function () {
          return opts.action ? opts.action(values) : { done: true, value: values.input };
        }).then(function (result) {
          if (settled) return;
          if (result && result.done) {
            close(result.value != null ? result.value : values.input);
            return;
          }
          setBusy(false);
          if (result && result.error) {
            error.textContent = String(result.error);
            return;
          }
          close(values.input);
        }, function (cause) {
          if (settled) return;
          setBusy(false);
          error.textContent = (cause && cause.message)
            ? String(cause.message)
            : "操作失败,请重试";
        });
      }
      cancel.addEventListener("click", function () {
        if (!busy) close(null);
      });
      submit.addEventListener("click", submitValues);
      if (input) {
        input.addEventListener("keydown", function (event) {
          if (event && event.key === "Enter") submitValues();
        });
      }
    });
  }

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

  // 已录入判定:站点(origin) 与账号(site_id+user_id) 都存在则返回账号行(含
  // access_token,用于复用);否则返回 null。点击流程会等待结果后再决定覆盖确认。
  function findRecordedAccount(auth) {
    if (!auth || !auth.userId) {
      return Promise.resolve(null);
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
      if (!site) return null;
      return findTtsItem(
        "/api/accounts",
        { siteId: site.id, accountQ: auth.userId },
        "读取账号",
        function (a) {
          return String(a.site_id) === String(site.id) &&
            String(a.user_id) === String(auth.userId);
        },
        1,
      );
    }).then(function (account) {
      return account || null;
    });
  }

  // 同源调 new-api。旧模式只带 session cookie + New-Api-User;新版模式额外带
  // 短期 Dashboard Bearer token(TTL 15 分钟,OAuth 授权等长流程可能过期,收到
  // 401 时自动刷新一次再重试)。extraHeaders 用于 X-Security-Proof 等。
  // 返回 HTTP 状态与解析后的 JSON,供鉴权分支判断。
  function napiRequest(method, path, auth, body, extraHeaders, skipRefreshRetry) {
    var headers = {
      "Cache-Control": "no-store",
      "New-Api-User": String(auth.userId),
    };
    if (auth.dashboardToken) {
      headers.Authorization = "Bearer " + auth.dashboardToken;
    }
    if (body) headers["Content-Type"] = "application/json";
    if (extraHeaders) {
      Object.keys(extraHeaders).forEach(function (key) {
        headers[key] = extraHeaders[key];
      });
    }
    return fetch(path, {
      method: method,
      credentials: "include",
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401 && !skipRefreshRetry && auth.dashboardToken) {
        return refreshModernAuth().then(function (fresh) {
          if (String(fresh.userId) !== String(auth.userId)) {
            // 浏览器里的 refresh cookie 可能已切换到另一个账号(同站多标签登录),
            // 身份不一致时立即中止,避免以错误账号执行后续请求。
            throw taggedError("登录账号已变化,请刷新页面后重试", "not_logged_in");
          }
          auth.dashboardToken = fresh.dashboardToken;
          auth.accessExpiresAt = fresh.accessExpiresAt;
          if (fresh.user) auth.user = fresh.user;
          return napiRequest(method, path, auth, body, extraHeaders, true);
        }, function (refreshError) {
          if (refreshError && refreshError.kind === "not_logged_in") {
            throw taggedError("登录状态已失效,请刷新页面后重试", "not_logged_in");
          }
          throw refreshError;
        });
      }
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

  // 用某个 accessToken 做同源请求(不带 dashboard token/cookie),返回状态与 JSON。
  function tokenRequest(method, path, token, userId) {
    return fetch(path, {
      method: method,
      credentials: "omit",
      headers: {
        "Authorization": "Bearer " + token,
        "New-Api-User": String(userId),
        "Cache-Control": "no-store",
      },
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (json) {
        return { status: r.status, ok: r.ok, json: json };
      });
    }, function () {
      return { status: 0, ok: false, json: null };
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

  // ── accessToken 获取:探测 → 复用 → 验证新建 → 旧版回退 ─────────────
  // 新版 new-api(≥ rc.41)用 scoped access token 取代单 PAT;创建令牌必须提供
  // 一次性 step-up proof。这里复刻上游前端的「验证方式 → proof → 建令牌」链路,
  // 并保留旧版(GET /api/user/token)与过渡版(rc.34–40,POST + proof)的回退。

  function findMethod(methods, name) {
    for (var i = 0; i < methods.length; i++) {
      var method = methods[i];
      if (method && method.method === name && method.available === true) {
        return method;
      }
    }
    return null;
  }

  function unavailableReason(methods) {
    for (var i = 0; i < methods.length; i++) {
      var method = methods[i];
      if (method && method.available === false &&
        typeof method.reason === "string" && method.reason) {
        return method.reason;
      }
    }
    return "";
  }

  // 用户取消弹窗:抛 cancelled 标记,由 runQuickEntry 静默中止。
  function cancelledOrValue(value) {
    if (value == null) throw taggedError("", "cancelled");
    return value;
  }

  function fetchVerificationMethods(auth, scope) {
    return napiRequest(
      "GET",
      "/api/verify/methods?scope=" + encodeURIComponent(scope),
      auth,
    ).then(function (r) {
      if (r.status === 401) {
        throw taggedError("登录状态已失效,请刷新页面后重试", "not_logged_in");
      }
      var data = r.json && r.json.success === true ? r.json.data : null;
      if (!data) {
        throw new Error(responseMessage(r.json, "读取验证方式失败(" + r.status + ")"));
      }
      return data;
    });
  }

  // 业务失败是 HTTP 200 + success:false;返回 {ok:false, code, message} 供弹窗重试。
  function postVerify(auth, body) {
    return napiRequest("POST", "/api/verify", auth, body).then(function (r) {
      if (r.status === 401) {
        throw taggedError("登录状态已失效,请刷新页面后重试", "not_logged_in");
      }
      var json = r.json;
      if (r.status >= 200 && r.status < 300 && json && json.success === false) {
        return {
          ok: false,
          code: typeof json.code === "string" ? json.code : "",
          message: responseMessage(json, "验证失败"),
        };
      }
      var proof = json && json.success === true && json.data
        ? json.data.proof_token
        : null;
      if (r.status >= 200 && r.status < 300 &&
        typeof proof === "string" && proof) {
        return { ok: true, proof: proof };
      }
      throw new Error(responseMessage(json, "验证失败(" + r.status + ")"));
    });
  }

  // ── 密码加密传输(PASSWORD_LOGIN_ENCRYPTION_ENABLED 站点)────────────
  var passwordEncryptionKey = null;

  function base64FromBuffer(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function pemToDerBuffer(pem) {
    var body = String(pem)
      .split("-----BEGIN PUBLIC KEY-----").join("")
      .split("-----END PUBLIC KEY-----").join("");
    var binary = atob(body.replace(/[^A-Za-z0-9+/=]/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function readPasswordEncryptionKey() {
    if (passwordEncryptionKey) return Promise.resolve(passwordEncryptionKey);
    return fetch("/api/user/login/encryption-key", {
      credentials: "include",
      headers: { "Cache-Control": "no-store" },
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (json) {
      var data = json && json.success === true ? json.data : null;
      if (!data || data.enabled !== true || !data.kid || !data.public_key) {
        throw new Error("上游未开放密码加密传输");
      }
      passwordEncryptionKey = {
        kid: String(data.kid),
        publicKey: String(data.public_key),
      };
      return passwordEncryptionKey;
    });
  }

  // 与上游前端一致:RSA-OAEP/SHA-256;超长密码用 v2 信封(AES-GCM 包裹)。
  function encryptPasswordValue(password, key) {
    var subtle = crypto && crypto.subtle;
    if (!subtle) {
      return Promise.reject(
        new Error("当前页面不支持密码加密传输(需要 HTTPS),请刷新后重试"),
      );
    }
    return subtle.importKey(
      "spki",
      pemToDerBuffer(key.publicKey),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    ).then(function (publicKey) {
      var encoder = new TextEncoder();
      var plaintext = encoder.encode(password);
      var maxBytes = (publicKey.algorithm.modulusLength / 8) - 66;
      if (plaintext.byteLength <= maxBytes) {
        return subtle.encrypt({ name: "RSA-OAEP" }, publicKey, plaintext)
          .then(function (cipher) {
            return {
              password_encrypted: base64FromBuffer(cipher),
              encryption_key_id: key.kid,
            };
          });
      }
      var secret = crypto.getRandomValues(new Uint8Array(32));
      var nonce = crypto.getRandomValues(new Uint8Array(12));
      return subtle.importKey("raw", secret, { name: "AES-GCM" }, false, ["encrypt"])
        .then(function (aesKey) {
          return Promise.all([
            subtle.encrypt(
              { name: "RSA-OAEP", label: encoder.encode("password-v2") },
              publicKey,
              secret,
            ),
            subtle.encrypt(
              {
                name: "AES-GCM",
                iv: nonce,
                additionalData: encoder.encode("password-v2:" + key.kid),
              },
              aesKey,
              plaintext,
            ),
          ]);
        }).then(function (parts) {
          return {
            password_encrypted: "v2." + base64FromBuffer(parts[0]) + "." +
              base64FromBuffer(nonce.buffer) + "." + base64FromBuffer(parts[1]),
            encryption_key_id: key.kid,
          };
        });
    });
  }

  function verifyPassword(auth, scope, context, password, encryptionEnabled) {
    var encrypted = encryptionEnabled
      ? readPasswordEncryptionKey().then(function (key) {
        return encryptPasswordValue(password, key);
      })
      : Promise.resolve(null);
    return encrypted.then(function (payload) {
      var body = { method: "password", scope: scope };
      if (context) body.context = context;
      if (payload) {
        body.password_encrypted = payload.password_encrypted;
        body.encryption_key_id = payload.encryption_key_id;
      } else {
        body.password = password;
      }
      return postVerify(auth, body);
    });
  }

  function verifyTwoFactor(auth, scope, context, code) {
    var body = { method: "2fa", scope: scope, code: String(code).trim() };
    if (context) body.context = context;
    return postVerify(auth, body);
  }

  // ── OAuth 授权验证(无密码账号设置密码时使用)──────────────────────
  function fetchStatusData() {
    return fetch("/api/status", {
      credentials: "include",
      headers: { "Cache-Control": "no-store" },
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (body) {
      return body && (body.data || body) || {};
    }).catch(function () { return {}; });
  }

  // 与上游前端 buildOAuthAuthorizationUrl 保持一致。
  function buildOAuthAuthorizationUrl(provider, state, status) {
    if (provider === "github" && status.github_client_id) {
      return "https://github.com/login/oauth/authorize?client_id=" +
        encodeURIComponent(status.github_client_id) +
        "&state=" + encodeURIComponent(state) + "&scope=user:email";
    }
    if (provider === "discord" && status.discord_client_id) {
      var discord = new URL("https://discord.com/oauth2/authorize");
      discord.searchParams.set("client_id", status.discord_client_id);
      discord.searchParams.set("redirect_uri", location.origin + "/oauth/discord");
      discord.searchParams.set("response_type", "code");
      discord.searchParams.set("scope", "identify+openid");
      discord.searchParams.set("state", state);
      return discord.toString();
    }
    if (provider === "oidc" && status.oidc_authorization_endpoint &&
      status.oidc_client_id) {
      var oidc = new URL(status.oidc_authorization_endpoint);
      oidc.searchParams.set("client_id", status.oidc_client_id);
      oidc.searchParams.set("redirect_uri", location.origin + "/oauth/oidc");
      oidc.searchParams.set("response_type", "code");
      oidc.searchParams.set("scope", "openid profile email");
      oidc.searchParams.set("state", state);
      return oidc.toString();
    }
    if (provider === "linuxdo" && status.linuxdo_client_id) {
      return "https://connect.linux.do/oauth2/authorize?response_type=code" +
        "&client_id=" + encodeURIComponent(status.linuxdo_client_id) +
        "&state=" + encodeURIComponent(state);
    }
    var customProviders = Array.isArray(status.custom_oauth_providers)
      ? status.custom_oauth_providers
      : [];
    for (var i = 0; i < customProviders.length; i++) {
      var custom = customProviders[i];
      if (custom && custom.slug === provider && custom.authorization_endpoint) {
        var url = new URL(custom.authorization_endpoint);
        url.searchParams.set("client_id", custom.client_id);
        url.searchParams.set("redirect_uri", location.origin + "/oauth/" + provider);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("state", state);
        if (custom.scopes) url.searchParams.set("scope", custom.scopes);
        return url.toString();
      }
    }
    throw new Error("未找到可用的第三方登录方式");
  }

  function oauthAuthorize(auth, scope, context, provider) {
    return fetchStatusData().then(function (status) {
      var payload = { provider: provider, intent: "verify", scope: scope };
      if (context) payload.context = context;
      return napiRequest("POST", "/api/oauth/state", auth, payload).then(function (r) {
        if (r.status === 401) {
          throw taggedError("登录状态已失效,请刷新页面后重试", "not_logged_in");
        }
        var data = r.json && r.json.success === true ? r.json.data : null;
        if (!data || typeof data.flow_token !== "string" || !data.flow_token) {
          throw new Error(responseMessage(r.json, "初始化 OAuth 授权失败(" + r.status + ")"));
        }
        var url = typeof data.authorization_url === "string" && data.authorization_url
          ? data.authorization_url
          : buildOAuthAuthorizationUrl(provider, data.flow_token, status);
        return { state: data.flow_token, url: url };
      });
    });
  }

  // 同步打开弹窗(此时还持有用户手势,避免异步等待后被拦截),拿到 state 后
  // 再写标记并跳转;关窗即取消,超时兜底。
  function openOAuthPopupWindow() {
    var popup = window.open("about:blank", "_blank");
    if (!popup) {
      return { error: new Error("OAuth 弹窗被浏览器拦截,请允许弹窗后重试") };
    }
    return { popup: popup };
  }

  function waitForOAuthCallback(auth, popup, provider, state, url) {
    if (popup.closed) {
      return Promise.reject(new Error("已取消 OAuth 授权"));
    }
    try {
      var storage = popup.sessionStorage;
      var key = "oauth_popup_flow:" + provider;
      var marker = JSON.stringify({ state: state, intent: "verify" });
      storage.setItem(key, marker);
      if (storage.getItem(key) !== marker) throw new Error("storage unavailable");
    } catch (_) {
      try { popup.close(); } catch (__) {}
      return Promise.reject(new Error("浏览器拒绝 OAuth 弹窗临时存储,请检查隐私设置"));
    }
    try { popup.location.replace(url); } catch (_) {}
    return new Promise(function (resolve, reject) {
      var done = false;
      var poll = null;
      var startedAt = Date.now();
      function cleanup() {
        window.removeEventListener("message", onMessage);
        clearInterval(poll);
      }
      function finish(error, code) {
        if (done) return;
        done = true;
        cleanup();
        try {
          popup.postMessage({
            type: "oauth:popup:result",
            intent: "verify",
            provider: provider,
            state: state,
            success: !error,
            message: error ? String(error.message || error) : "",
          }, location.origin);
        } catch (_) {}
        try { popup.close(); } catch (_) {}
        if (error) reject(error);
        else resolve(code);
      }
      function onMessage(event) {
        if (!event || event.origin !== location.origin || event.source !== popup) {
          return;
        }
        var data = event.data;
        if (!data || data.type !== "oauth:popup:callback" ||
          data.intent !== "verify" || data.provider !== provider ||
          data.state !== state) {
          return;
        }
        if (typeof data.error === "string" && data.error) {
          var description = typeof data.errorDescription === "string" && data.errorDescription
            ? data.errorDescription
            : "";
          // 把 provider 的拒绝回传给上游回调端点消费掉这次 flow(与上游前端一致),
          // 避免遗留待过期的授权记录;失败也不影响本地报错。
          var errorQuery = "state=" + encodeURIComponent(state) +
            "&error=" + encodeURIComponent(data.error) +
            (description ? "&error_description=" + encodeURIComponent(description) : "");
          napiRequest(
            "GET",
            "/api/oauth/" + encodeURIComponent(provider) + "?" + errorQuery,
            auth,
          ).catch(function () {});
          finish(new Error(description || ("OAuth 授权失败: " + data.error)));
          return;
        }
        if (typeof data.code !== "string" || !data.code) return;
        finish(null, data.code);
      }
      window.addEventListener("message", onMessage);
      poll = setInterval(function () {
        if (popup.closed) {
          finish(new Error("已取消 OAuth 授权"));
          return;
        }
        if (Date.now() - startedAt > OAUTH_POPUP_DEADLINE_MS) {
          finish(new Error("OAuth 授权超时,请重试"));
        }
      }, OAUTH_POPUP_POLL_MS);
    });
  }

  function verifyOAuth(auth, scope, context, provider) {
    var opened = openOAuthPopupWindow();
    if (opened.error) return Promise.reject(opened.error);
    var popup = opened.popup;
    return oauthAuthorize(auth, scope, context, provider).then(function (authorization) {
      return waitForOAuthCallback(auth, popup, provider, authorization.state, authorization.url)
        .then(function (code) {
          var query = "state=" + encodeURIComponent(authorization.state) +
            "&code=" + encodeURIComponent(code);
          return napiRequest(
            "GET",
            "/api/oauth/" + encodeURIComponent(provider) + "?" + query,
            auth,
          );
        }).then(function (r) {
          if (r.status === 401) {
            throw taggedError("登录状态已失效,请刷新页面后重试", "not_logged_in");
          }
          var json = r.json;
          var proof = json && json.success === true && json.data
            ? json.data.proof_token
            : null;
          if (r.status >= 200 && r.status < 300 &&
            typeof proof === "string" && proof) {
            return proof;
          }
          throw new Error(responseMessage(json, "OAuth 验证失败(" + r.status + ")"));
        });
    }).catch(function (error) {
      try { popup.close(); } catch (_) {}
      throw error;
    });
  }

  // ── 令牌探测 / 复用 / 新建 ─────────────────────────────────────────
  function probeScopedSupport(auth) {
    if (!auth.dashboardToken) return Promise.resolve({ supported: false });
    return napiRequest("GET", "/api/user/access_tokens", auth).then(function (r) {
      if (r.status === 401) {
        throw taggedError("登录状态已失效,请刷新页面后重试", "not_logged_in");
      }
      if (r.status === 429) {
        throw new Error("上游请求过于频繁,请稍后重试");
      }
      if (r.status >= 500) {
        throw new Error("上游服务暂时不可用(" + r.status + "),请稍后重试");
      }
      var json = r.json;
      if (r.status >= 200 && r.status < 300 && json && json.success === true && json.data) {
        return { supported: true };
      }
      return { supported: false };
    });
  }

  // 只读探测:令牌可登录、可读 APIKey(可选读签到);403 视为缺权限。
  function probeToken(userId, token) {
    return tokenRequest("GET", "/api/user/self", token, userId).then(function (self) {
      if (!self.ok || !self.json || self.json.success !== true || !self.json.data) {
        return { ok: false, message: "访问令牌无效或与当前账号不匹配" };
      }
      if (String(self.json.data.id) !== String(userId)) {
        return { ok: false, message: "访问令牌属于其他账号" };
      }
      return tokenRequest("GET", "/api/token/?p=1&page_size=10", token, userId)
        .then(function (list) {
          if (list.status === 403) {
            return { ok: false, message: "令牌缺少查看 APIKey 的权限(api_key:read)" };
          }
          return tokenRequest("GET", "/api/user/checkin", token, userId)
            .then(function (checkin) {
              if (checkin.status === 403) {
                return { ok: false, message: "令牌缺少签到相关权限(wallet:read)" };
              }
              return { ok: true };
            });
        });
    });
  }

  // scoped 令牌指纹 = hex(sha256(token)),与上游 token_ref 一致,可精确校验
  // 权限与过期时间;HTTP 页面无 subtle crypto 时跳过(只依赖探测)。
  function tokenRefOf(token) {
    var subtle = crypto && crypto.subtle;
    if (!subtle || typeof subtle.digest !== "function") {
      return Promise.resolve(null);
    }
    var data = new TextEncoder().encode(String(token).replace(/[ ]+$/g, ""));
    return subtle.digest("SHA-256", data).then(function (digest) {
      var bytes = new Uint8Array(digest);
      var hex = "";
      for (var i = 0; i < bytes.length; i++) {
        var part = bytes[i].toString(16);
        hex += part.length === 1 ? "0" + part : part;
      }
      return hex;
    }).catch(function () { return null; });
  }

  function scopedTokenCheck(auth, token, strict) {
    return tokenRefOf(token).then(function (ref) {
      if (!ref) return { ok: true };
      return napiRequest("GET", "/api/user/access_tokens", auth).then(function (r) {
        if (r.status === 429) {
          return { ok: false, message: "上游请求过于频繁,请稍后重试" };
        }
        if (r.status >= 500) {
          return { ok: false, message: "上游服务暂时不可用(" + r.status + "),请稍后重试" };
        }
        var data = r.json && r.json.success === true ? r.json.data : null;
        if (!data || !Array.isArray(data.items)) return { ok: true };
        var item = null;
        for (var i = 0; i < data.items.length; i++) {
          if (data.items[i] && data.items[i].token_ref === ref) {
            item = data.items[i];
            break;
          }
        }
        if (!item) {
          // 复用场景(严格):指纹不在列表里说明令牌已被删除/轮换,应重建;
          // 手动粘贴场景:分叉站点的指纹算法可能不同,放行走只读探测结论。
          return strict
            ? { ok: false, message: "该令牌已不在访问令牌列表中,请重新创建" }
            : { ok: true };
        }
        var scopes = Array.isArray(item.scopes) ? item.scopes : [];
        var missing = [];
        for (var j = 0; j < PAT_SCOPES.length; j++) {
          if (scopes.indexOf(PAT_SCOPES[j]) === -1) missing.push(PAT_SCOPES[j]);
        }
        if (missing.length) {
          return { ok: false, message: "令牌缺少权限:" + missing.join("、") };
        }
        if (Number(item.expires_at) > 0) {
          return { ok: false, message: "令牌不是「永不过期」,请重新创建" };
        }
        return { ok: true };
      });
    });
  }

  function reuseWhenPossible(auth, storedToken, scoped) {
    var token = storedToken == null ? "" : String(storedToken).trim();
    if (!token) return Promise.resolve(null);
    var isScopedToken = token.indexOf("nap_") === 0;
    if (scoped.supported && !isScopedToken) return Promise.resolve(null);
    return probeToken(auth.userId, token).then(function (probe) {
      if (!probe.ok) return null;
      if (!scoped.supported || !isScopedToken) return token;
      return scopedTokenCheck(auth, token, true).then(function (check) {
        return check.ok ? token : null;
      });
    });
  }

  function createScopedToken(auth, proof) {
    return napiRequest("POST", "/api/user/access_tokens", auth, {
      name: PAT_NAME,
      scopes: PAT_SCOPES,
      expires_at: PAT_EXPIRES_AT,
    }, { "X-Security-Proof": proof }).then(function (r) {
      var json = r.json;
      var token = json && json.success === true && json.data
        ? json.data.token
        : null;
      if (r.status >= 200 && r.status < 300 &&
        typeof token === "string" && token.trim()) {
        return token.trim();
      }
      if (json && json.code === "ACCESS_TOKEN_LIMIT") {
        throw new Error("上游访问令牌数量已达上限(20 个),请先在「安全」页面删除旧令牌");
      }
      throw new Error(responseMessage(json, "创建访问令牌失败(" + r.status + ")"));
    });
  }

  // 旧版(≤ rc.33)直接 GET 明文;rc.34–40 该端点要求 X-Security-Proof。
  function legacyAccessTokenFlow(auth) {
    return napiRequest("GET", "/api/user/token", auth).then(function (r) {
      var json = r.json;
      if (r.status >= 200 && r.status < 300 && json && json.success === true &&
        typeof json.data === "string" && json.data.trim()) {
        return json.data.trim();
      }
      if (r.status === 401) {
        throw taggedError("登录状态已失效,请刷新页面后重试", "not_logged_in");
      }
      var code = json && json.code;
      if (r.status === 403 && typeof code === "string" &&
        code.indexOf("SECURITY_PROOF") === 0) {
        return withVerification(auth, { supported: false, context: null }, function (proof) {
          return napiRequest("POST", "/api/user/token", auth, null, {
            "X-Security-Proof": proof,
          }).then(function (r2) {
            var json2 = r2.json;
            var token = json2 && json2.success === true ? json2.data : null;
            if (r2.status >= 200 && r2.status < 300 &&
              typeof token === "string" && token.trim()) {
              return token.trim();
            }
            throw new Error(responseMessage(json2, "生成 accessToken 失败(" + r2.status + ")"));
          });
        });
      }
      throw new Error(responseMessage(json, "获取 accessToken 失败(" + r.status + ")"));
    });
  }

  function passwordDialog(auth, request, initialError) {
    var username = auth.user && auth.user.username
      ? String(auth.user.username)
      : "";
    return ttsDialog({
      title: "安全验证",
      desc: "new-api 要求验证身份后才能创建访问令牌。",
      note: username ? ("账号:" + username) : "",
      error: initialError || "",
      input: { type: "password", label: "登录密码", value: "" },
      submitText: "验证",
      action: function (values) {
        var password = String(values.input || "");
        if (!password) return Promise.resolve({ error: "请输入登录密码" });
        return verifyPassword(
          auth,
          request.scope,
          request.context,
          password,
          request.encryptionEnabled,
        ).then(function (result) {
          if (result.ok) {
            return request.complete(result.proof).then(function (token) {
              return { done: true, value: token };
            });
          }
          if (result.code === "SECURITY_VERIFICATION_FAILED") {
            return { error: "密码不正确,请重试" };
          }
          if (result.code === "SECURITY_VERIFICATION_LOCKED") {
            return { error: result.message || "验证暂时锁定,请稍后再试" };
          }
          return { error: result.message || "验证失败,请重试" };
        });
      },
    }).then(cancelledOrValue);
  }

  function passwordFlow(auth, request) {
    var username = auth.user && auth.user.username
      ? String(auth.user.username)
      : "";
    var silent = username
      ? verifyPassword(
        auth,
        request.scope,
        request.context,
        username,
        request.encryptionEnabled,
      )
      : Promise.resolve({ ok: false, code: "NO_USERNAME", message: "" });
    return silent.then(function (result) {
      if (result.ok) return request.complete(result.proof);
      var initialError = result.code === "SECURITY_VERIFICATION_FAILED"
        ? ""
        : (result.message || "");
      return passwordDialog(auth, request, initialError);
    });
  }

  function twoFactorFlow(auth, request) {
    return ttsDialog({
      title: "安全验证",
      desc: "该账号启用了两步验证,请输入动态验证码后继续。",
      input: {
        type: "text",
        label: "动态验证码",
        value: "",
        placeholder: "6 位动态码或备用码",
      },
      submitText: "验证",
      action: function (values) {
        var code = String(values.input || "").trim();
        if (!code) return Promise.resolve({ error: "请输入动态验证码" });
        return verifyTwoFactor(auth, request.scope, request.context, code)
          .then(function (result) {
            if (result.ok) {
              return request.complete(result.proof).then(function (token) {
                return { done: true, value: token };
              });
            }
            if (result.code === "SECURITY_VERIFICATION_FAILED") {
              return { error: "验证码不正确,请重试" };
            }
            if (result.code === "SECURITY_VERIFICATION_LOCKED") {
              return {
                error: result.message ||
                  "验证失败次数过多,已临时锁定,请稍后再试",
              };
            }
            return { error: result.message || "验证失败,请重试" };
          });
      },
    }).then(cancelledOrValue);
  }

  function setAccountPassword(auth, proof, password) {
    return napiRequest("PUT", "/api/user/self", auth, { password: password }, {
      "X-Security-Proof": proof,
    }).then(function (r) {
      if (r.status === 401) {
        throw taggedError("登录状态已失效,请刷新页面后重试", "not_logged_in");
      }
      var json = r.json;
      if (r.status >= 200 && r.status < 300 && json && json.success === true) {
        // 设置密码会提升 auth_version 并轮换当前会话,采用响应里的新 dashboard token。
        var data = json.data || null;
        if (data && typeof data.access_token === "string" && data.access_token) {
          auth.dashboardToken = data.access_token;
          var expiresAt = Number(data.access_expires_at);
          if (isFinite(expiresAt) && expiresAt > 0) auth.accessExpiresAt = expiresAt;
        }
        return;
      }
      var code = json && json.code;
      if (code === "PASSWORD_POLICY_REJECTED") {
        throw new Error(responseMessage(json, "密码不符合要求(8–128 个字符)"));
      }
      if (code === "SECURITY_PROOF_EXPIRED" || code === "SECURITY_PROOF_CONSUMED" ||
        code === "SECURITY_PROOF_INVALID") {
        throw new Error("验证已过期,请重试");
      }
      throw new Error(responseMessage(json, "设置密码失败(" + r.status + ")"));
    });
  }

  // 无密码(OAuth-only)账号:设置密码需要一次 account.password.set 的 OAuth
  // 授权;设置成功后立即用新密码静默验证并创建令牌。
  function setPasswordFlow(auth, request) {
    var username = auth.user && auth.user.username
      ? String(auth.user.username)
      : "";
    var providerOptions = request.providers.map(function (provider) {
      return {
        value: String(provider.slug),
        label: String(provider.name || provider.slug),
      };
    });
    var firstProvider = providerOptions.length ? providerOptions[0] : null;
    // 设置密码成功后账号已具备密码:重试时不能再走 account.password.set
    // (上游会对已有密码的账号直接拒绝),改为直接用该密码验证并建令牌。
    var passwordSet = false;
    return ttsDialog({
      title: "设置账号密码",
      desc: "该账号未设置密码,且 new-api 要求先完成一次第三方登录授权验证。\\n" +
        "脚本将为该账号设置密码(默认使用用户名),随后创建访问令牌并保存。",
      note: "密码需为 8–128 个字符;设置密码会登出该账号的其他浏览器会话。",
      input: {
        type: "password",
        label: "新密码",
        value: username,
        placeholder: "8–128 个字符",
      },
      select: providerOptions.length > 1
        ? { label: "使用授权方式", options: providerOptions }
        : null,
      submitText: "授权并继续",
      action: function (values) {
        var password = String(values.input || "");
        var passwordLength = Array.from(password).length;
        if (passwordSet) {
          return verifyPassword(
            auth,
            request.scope,
            request.context,
            password,
            request.encryptionEnabled,
          ).then(function (result) {
            if (!result.ok) {
              throw new Error("密码已设置成功;请使用刚才设置的密码继续验证:" +
                (result.message || "验证失败"));
            }
            return request.complete(result.proof);
          }).then(function (token) {
            return { done: true, value: token };
          });
        }
        if (passwordLength < 8 || passwordLength > 128) {
          return Promise.resolve({ error: "密码需为 8–128 个字符" });
        }
        var provider = values.select || (firstProvider ? firstProvider.value : "");
        if (!provider) {
          return Promise.resolve({ error: "未找到可用的第三方登录方式" });
        }
        return verifyOAuth(auth, PASSWORD_SET_SCOPE, null, provider)
          .then(function (proof) {
            return setAccountPassword(auth, proof, password);
          }).then(function () {
            passwordSet = true;
            return verifyPassword(
              auth,
              request.scope,
              request.context,
              password,
              request.encryptionEnabled,
            );
          }).then(function (result) {
            if (!result.ok) {
              throw new Error(result.message || "密码验证失败,请重试");
            }
            return request.complete(result.proof);
          }).then(function (token) {
            return { done: true, value: token };
          });
      },
    }).then(cancelledOrValue);
  }

  function manualFlow(auth, request, scopedSupported, extraReason) {
    var lines = [];
    if (extraReason) lines.push(extraReason);
    var reason = unavailableReason(request.methods);
    if (reason) lines.push("提示:" + reason);
    if (scopedSupported) {
      lines.push("该账号需要用 Passkey 或脚本尚未支持的验证方式,无法自动创建访问令牌。");
      lines.push("请在上游「安全」页面手动创建访问令牌:");
      lines.push("1. 名称任意,权限勾选以下全部:" + PAT_SCOPES.join("、"));
      lines.push("2. 过期时间选择「永不过期」;");
      lines.push("3. 复制生成的令牌(nap_ 开头)粘贴到下方。");
    } else {
      lines.push("该账号需要用脚本尚未支持的验证方式,请先在 new-api 安全设置中");
      lines.push("生成访问令牌(可能需要完成验证),然后粘贴到下方。");
    }
    return ttsDialog({
      title: "手动创建访问令牌",
      desc: lines.join("\\n"),
      link: { label: "打开上游安全页面(新标签)", href: location.origin + "/security" },
      input: { type: "text", label: "访问令牌", value: "", placeholder: "nap_..." },
      submitText: "使用该令牌",
      action: function (values) {
        var token = String(values.input || "").trim();
        if (!token) return Promise.resolve({ error: "请粘贴访问令牌" });
        if (scopedSupported && token.indexOf("nap_") !== 0) {
          return Promise.resolve({
            error: "请粘贴新版访问令牌(nap_ 开头);旧版 accessToken 即将失效",
          });
        }
        return probeToken(auth.userId, token).then(function (probe) {
          if (!probe.ok) return { error: probe.message };
          if (!scopedSupported) return { done: true, value: token };
          return scopedTokenCheck(auth, token, false).then(function (check) {
            if (!check.ok) return { error: check.message };
            return { done: true, value: token };
          });
        });
      },
    }).then(cancelledOrValue);
  }

  function hasSubtleCrypto() {
    return !!(crypto && crypto.subtle);
  }

  // HTTP 明文页面无法用 WebCrypto 做 RSA-OAEP;加密站点只能走手动粘贴。
  var ENCRYPTION_HTTP_REASON =
    "提示:该站点启用了密码加密传输,当前 HTTP 页面无法完成加密;";

  function withVerification(auth, options, complete) {
    return fetchVerificationMethods(auth, ACCESS_TOKEN_SCOPE).then(function (data) {
      var methods = Array.isArray(data.methods) ? data.methods : [];
      var providers = Array.isArray(data.oauth_providers) ? data.oauth_providers : [];
      var request = {
        scope: ACCESS_TOKEN_SCOPE,
        context: options.context,
        encryptionEnabled: data.password_encryption_enabled === true,
        complete: complete,
        methods: methods,
        providers: providers,
      };
      var passwordNeeded = Boolean(findMethod(methods, "password")) ||
        (!findMethod(methods, "2fa") && providers.length > 0);
      if (passwordNeeded && request.encryptionEnabled && !hasSubtleCrypto()) {
        return manualFlow(auth, request, options.supported === true, ENCRYPTION_HTTP_REASON);
      }
      if (findMethod(methods, "password")) return passwordFlow(auth, request);
      if (findMethod(methods, "2fa")) return twoFactorFlow(auth, request);
      if (providers.length) return setPasswordFlow(auth, request);
      return manualFlow(auth, request, options.supported === true);
    });
  }

  function ensureAccessToken(auth, storedToken) {
    return probeScopedSupport(auth).then(function (scoped) {
      return reuseWhenPossible(auth, storedToken, scoped).then(function (reused) {
        if (reused) return reused;
        if (scoped.supported) {
          return withVerification(auth, {
            supported: true,
            context: { scopes: PAT_SCOPES, expires_at: PAT_EXPIRES_AT },
          }, function (proof) {
            return createScopedToken(auth, proof);
          });
        }
        return legacyAccessTokenFlow(auth);
      });
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
    var recordedAccount = null;
    var origin = normOrigin(location.origin);
    var siteId = null;
    var accessToken = null;
    quickBusy = true;
    // 1.解析并验证当前用户 → 2.确认覆盖 → 3.保存站点 → 4.获取/复用令牌 →
    // 5.确保 APIKey → 6.保存账号(均 upsert) → 7.签到一次。
    TTS_UPSTREAM_UI.progress("验证登录…", 5);
    resolveAuth().then(function (resolved) {
      auth = resolved;
      return findRecordedAccount(auth);
    }).then(function (account) {
      recordedAccount = account;
      wasRecorded = !!account;
      if (wasRecorded && !confirm(
        "该账号已录入。重新保存会复用已保存的 access token;" +
          "令牌不可用时会创建新令牌(可能需要验证身份)并覆盖已有记录,确定继续?",
      )) {
        throw taggedError("", "cancelled");
      }
      TTS_UPSTREAM_UI.progress("保存站点…", 15);
      return tts("POST", "/api/sites", { origin: origin });
    }).then(function (r) {
      siteId = checkStatus(r, "保存站点").id;
      TTS_UPSTREAM_UI.progress("获取令牌…", 40);
      return ensureAccessToken(
        auth,
        recordedAccount && recordedAccount.access_token,
      );
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
        return findRecordedAccount(auth);
      }).catch(function () {});
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
