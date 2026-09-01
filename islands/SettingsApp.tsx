import { useEffect, useState } from "preact/hooks";
import { IconClock, IconSave } from "../components/icons.tsx";
import { apiGet, apiSend } from "../components/admin_api.ts";

type Settings = Record<string, string>;

interface CheckinAutomationStatus {
  enabled: boolean;
  timeoutSeconds: number;
  runtime: {
    available: boolean;
    wrapperVersion: string | null;
    chromiumVersion: string | null;
    error: string | null;
  };
  busy: boolean;
}

function Info({ tip }: { tip: string }) {
  return <span class="info" tabindex={0} data-tip={tip}>?</span>;
}

function Stepper(
  { value, onChange, min, max, step = 1 }: {
    value: string;
    onChange: (v: string) => void;
    min?: number;
    max?: number;
    step?: number;
  },
) {
  const num = Number(value) || 0;
  const clamp = (x: number) =>
    Math.min(max ?? Infinity, Math.max(min ?? -Infinity, x));
  return (
    <div class="stepper">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
      />
      <button
        type="button"
        data-dir="down"
        onClick={() => onChange(String(clamp(num - step)))}
      >
        −
      </button>
      <button
        type="button"
        data-dir="up"
        onClick={() => onChange(String(clamp(num + step)))}
      >
        +
      </button>
    </div>
  );
}

function rand(n: number) {
  let s = "sk-tts-";
  const c = "abcdef0123456789";
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

const CRON_FIELDS: [string, string, string][] = [
  ["cron_account_checkin", "账号签到", "自动为支持签到的站点领取每日额度。"],
  ["cron_account_quota_sync", "账号额度同步", "同步各账号剩余与已用额度。"],
  ["cron_site_health_check", "站点健康检查", "定期探测站点可用性与状态。"],
  ["cron_model_sync", "模型同步", "拉取各 Key 可用的上游模型列表。"],
  ["cron_request_log_cleanup", "请求日志清理", "清理超出保留期的请求日志。"],
];

export default function SettingsApp() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [automationStatus, setAutomationStatus] = useState<
    CheckinAutomationStatus | null
  >(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    apiGet<Settings>("/settings").then(setS).catch(() =>
      setErr("加载设置失败")
    );
    void loadAutomationStatus();
  }, []);

  async function loadAutomationStatus() {
    setStatusLoading(true);
    setStatusError("");
    try {
      setAutomationStatus(
        await apiGet<CheckinAutomationStatus>("/checkin-automation/status"),
      );
    } catch {
      setAutomationStatus(null);
      setStatusError("运行状态获取失败");
    } finally {
      setStatusLoading(false);
    }
  }

  function set(key: string, value: string) {
    setS((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  async function save() {
    if (!s || busy) return;
    setBusy(true);
    setErr("");
    try {
      const next = await apiSend<Settings>("PATCH", "/settings", s);
      setS(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch {
      setErr("保存失败");
    } finally {
      setBusy(false);
    }
  }

  if (err && !s) {
    return (
      <div class="page-head">
        <div>
          <h1 class="page-title">系统设置</h1>
          <p class="page-sub" style="color:var(--bad)">{err}</p>
        </div>
      </div>
    );
  }
  if (!s) {
    return (
      <div class="page-head">
        <div>
          <h1 class="page-title">系统设置</h1>
          <p class="page-sub">加载中…</p>
        </div>
      </div>
    );
  }

  return (
    <div class="set-wrap">
      <div class="page-head">
        <div>
          <h1 class="page-title">系统设置</h1>
          <p class="page-sub">
            实例级配置 · 悬停{" "}
            <span class="info" style="vertical-align:-2px">?</span>{" "}
            查看说明 · 修改后点击保存
          </p>
        </div>
      </div>

      {/* 基础参数 */}
      <section class="card card-pad set-group">
        <h2>
          基础参数<span class="gline"></span>
        </h2>
        <div class="set-grid">
          <div class="set-item span4">
            <span class="ilabel">
              <Info tip="调用中转接口(/v1/*)时需携带的鉴权密钥,每行一个;主 AUTH_KEY 始终自动生效。" />全局代理密钥（proxy_auth_keys）
            </span>
            <div class="token-row">
              <textarea
                class="textarea"
                style="font-family:var(--font-mono);font-size:12.5px"
                placeholder="每行一个密钥"
                value={s.proxy_auth_keys}
                onInput={(e) =>
                  set(
                    "proxy_auth_keys",
                    (e.target as HTMLTextAreaElement).value,
                  )}
              />
            </div>
            <span class="hint">
              当前生效密钥数：{s.proxy_auth_keys.split(/\r?\n/).filter(Boolean)
                .length}（含主 AUTH_KEY）
            </span>
            <div class="kbar" style="margin-top:6px">
              <button
                type="button"
                class="btn btn-sm"
                onClick={() =>
                  set(
                    "proxy_auth_keys",
                    (s.proxy_auth_keys ? s.proxy_auth_keys + "\n" : "") +
                      rand(28),
                  )}
              >
                生成一个新密钥
              </button>
            </div>
          </div>
          <div class="set-item">
            <span class="ilabel">
              <Info tip="超过该天数的请求日志将被定时任务自动清理。" />日志保留时长（天）
            </span>
            <Stepper
              min={1}
              value={s.request_log_retention_days}
              onChange={(v) => set("request_log_retention_days", v)}
            />
          </div>
          <div class="set-item">
            <span class="ilabel">
              <Info tip="请求日志批量落盘的间隔,0 表示实时写入。" />日志延迟写入周期（分钟）
            </span>
            <Stepper
              min={0}
              value={s.request_log_flush_interval_minutes}
              onChange={(v) => set("request_log_flush_interval_minutes", v)}
            />
          </div>
        </div>
      </section>

      {/* 请求与重试 */}
      <section class="card card-pad set-group">
        <h2>
          请求与重试<span class="gline"></span>
        </h2>
        <div class="set-grid">
          <div class="set-item">
            <span class="ilabel">
              <Info tip="等待上游返回响应头的最长时间(秒);流式响应体生成时长不受此限。" />响应头超时（秒）
            </span>
            <Stepper
              min={1}
              value={s.upstream_header_timeout_seconds}
              onChange={(v) => set("upstream_header_timeout_seconds", v)}
            />
          </div>
          <div class="set-item">
            <span class="ilabel">
              <Info tip="请求失败后在其它健康通道上的最大重试次数,0 表示不重试。" />最大重试次数（channel_retry_count）
            </span>
            <Stepper
              min={0}
              value={s.channel_retry_count}
              onChange={(v) => set("channel_retry_count", v)}
            />
          </div>
        </div>
      </section>

      {/* 浏览器自动签到 */}
      <section class="card card-pad set-group">
        <h2>
          浏览器自动签到<span class="gline"></span>
        </h2>
        <div class="set-grid">
          <div class="set-item">
            <span class="ilabel">
              <Info tip="普通 API 签到提示 Cloudflare Turnstile 等人机验证时，自动使用 CloakBrowser 打开个人中心并完成验证。" />自动验证
            </span>
            <label class="switch" title="启用浏览器自动签到">
              <input
                type="checkbox"
                checked={s.browser_checkin_enabled === "true"}
                onChange={(e) =>
                  set(
                    "browser_checkin_enabled",
                    (e.target as HTMLInputElement).checked ? "true" : "false",
                  )}
              />
              <span class="track"></span>
            </label>
            <span class="hint">
              关闭后需要人机验证的账号仍会标记为「需手动」。
            </span>
          </div>
          <div class="set-item">
            <span class="ilabel">
              <Info tip="一次浏览器验证从启动到确认签到结果的总时限，范围 30–120 秒。" />验证超时（秒）
            </span>
            <Stepper
              min={30}
              max={120}
              value={s.browser_checkin_timeout_seconds}
              onChange={(v) => set("browser_checkin_timeout_seconds", v)}
            />
          </div>
          <div class="set-item span2">
            <span class="ilabel">
              <Info tip="运行状态只检查构建中的 CloakBrowser 与全局执行租约，不会返回二进制路径或许可证。" />运行状态
            </span>
            <div class="kbar">
              {statusLoading && !automationStatus
                ? <span class="pill pill-mute">检测中…</span>
                : automationStatus?.runtime.available
                ? <span class="pill pill-ok">运行时可用</span>
                : <span class="pill pill-bad">运行时不可用</span>}
              {automationStatus && (
                <span
                  class={`pill ${
                    automationStatus.busy ? "pill-warn" : "pill-mute"
                  }`}
                >
                  {automationStatus.busy ? "正在验证" : "当前空闲"}
                </span>
              )}
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={statusLoading}
                onClick={() => void loadAutomationStatus()}
              >
                {statusLoading ? "检测中…" : "刷新状态"}
              </button>
            </div>
            {automationStatus?.runtime.available && (
              <span class="hint mono">
                CloakBrowser {automationStatus.runtime.wrapperVersion ?? "?"}
                {" · Chromium "}
                {automationStatus.runtime.chromiumVersion ?? "?"}
              </span>
            )}
            {(statusError || automationStatus?.runtime.error) && (
              <span class="hint" style="color:var(--bad)">
                {statusError || automationStatus?.runtime.error}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 定时任务 */}
      <section class="card card-pad set-group">
        <h2>
          定时任务（Cron）<span class="gline"></span>
        </h2>
        <div class="cron-note">
          <IconClock />
          表达式按 UTC 解释（day-of-week 用 1-7 =
          SUN-SAT）；修改后需重启服务方可生效。
        </div>
        <div class="set-grid">
          {CRON_FIELDS.map(([key, label, tip]) => (
            <div class="set-item span2 cron-input" key={key}>
              <span class="ilabel">
                <Info tip={`${key} · ${tip}`} />
                {label}
              </span>
              <input
                class="input"
                value={s[key]}
                onInput={(e) =>
                  set(key, (e.target as HTMLInputElement).value)}
              />
            </div>
          ))}
        </div>
      </section>

      {err && (
        <p class="page-sub" style="color:var(--bad);text-align:center">{err}</p>
      )}
      <div class="save-row">
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy || saved}
          onClick={save}
        >
          {saved ? "已保存 ✓" : busy ? "保存中…" : (
            <>
              <IconSave />
              保存设置
            </>
          )}
        </button>
      </div>
    </div>
  );
}
