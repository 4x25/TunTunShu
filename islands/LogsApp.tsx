import { useEffect, useState } from "preact/hooks";
import { apiGet, fetchAllPages } from "../components/admin_api.ts";

interface ReqLog {
  id: string;
  created_at: string;
  status: "success" | "failed";
  request_type: "final" | "retry";
  http_status: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  request_ip: string | null;
  request_path: string;
  request_model: string | null;
  upstream_url: string | null;
  upstream_model: string | null;
  error_message: string | null;
}
interface SysLog {
  id: string;
  created_at: string;
  task_type: string;
  status: "success" | "failed" | "skipped";
  site_id: string | null;
  account_id: string | null;
  api_key_id: string | null;
  message: string | null;
}

const TASK_LABEL: Record<string, string> = {
  site_health_check: "站点健康检查",
  account_checkin: "账号签到",
  account_quota_sync: "账号额度同步",
  account_api_key_sync: "账号 APIKey 同步",
  api_key_model_sync: "APIKey 模型同步",
  request_log_flush: "请求日志落盘",
  request_log_cleanup: "请求日志清理",
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}
function hostOf(url: string | null): string {
  if (!url) return "—";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function httpCol(h: number | null) {
  if (h == null) return "var(--faint)";
  return h >= 500 ? "var(--bad)" : h >= 400 ? "var(--warn)" : "var(--ok)";
}

function StatPill({ s }: { s: string }) {
  return s === "success"
    ? (
      <span class="pill pill-ok">
        <span class="dot"></span>成功
      </span>
    )
    : (
      <span class="pill pill-bad">
        <span class="dot"></span>失败
      </span>
    );
}
function TaskStat({ s }: { s: string }) {
  if (s === "success") {
    return (
      <span class="pill pill-ok">
        <span class="dot"></span>成功
      </span>
    );
  }
  if (s === "failed") {
    return (
      <span class="pill pill-bad">
        <span class="dot"></span>失败
      </span>
    );
  }
  return (
    <span class="pill pill-mute">
      <span class="dot"></span>跳过
    </span>
  );
}
function DI({ k, v }: { k: string; v: string }) {
  return (
    <div class="di">
      <div class="dk">{k}</div>
      <div class="dv">{v}</div>
    </div>
  );
}

export default function LogsApp() {
  const [curTab, setCurTab] = useState<"req" | "sys">("req");
  const [reqLogs, setReqLogs] = useState<ReqLog[]>([]);
  const [sysLogs, setSysLogs] = useState<SysLog[]>([]);
  const [names, setNames] = useState<{
    sites: Record<string, string>;
    accounts: Record<string, string>;
    keys: Record<string, string>;
    accSite: Record<string, string>; // 账号 id → 所属站点 id
    keyAcc: Record<string, string>; // APIKey id → 所属账号 id
  }>({ sites: {}, accounts: {}, keys: {}, accSite: {}, keyAcc: {} });
  const [loading, setLoading] = useState(true);

  const [reqQ, setReqQ] = useState("");
  const [reqStatus, setReqStatus] = useState("all");
  const [reqType, setReqType] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sysQ, setSysQ] = useState("");
  const [sysTask, setSysTask] = useState("all");
  const [sysStatus, setSysStatus] = useState("all");

  async function load() {
    setLoading(true);
    try {
      const [req, sys, sites, accounts, keys] = await Promise.all([
        apiGet<ReqLog[]>("/request-logs"),
        apiGet<SysLog[]>("/system-task-logs"),
        fetchAllPages<{ id: string; name: string }>("/sites"),
        fetchAllPages<{ id: string; name: string; site_id: string }>(
          "/accounts",
        ),
        fetchAllPages<{ id: string; name: string; account_id: string }>(
          "/api-keys",
        ),
      ]);
      setReqLogs(req);
      setSysLogs(sys);
      setNames({
        sites: Object.fromEntries(sites.map((x) => [x.id, x.name])),
        accounts: Object.fromEntries(accounts.map((x) => [x.id, x.name])),
        keys: Object.fromEntries(keys.map((x) => [x.id, x.name])),
        accSite: Object.fromEntries(accounts.map((x) => [x.id, x.site_id])),
        keyAcc: Object.fromEntries(keys.map((x) => [x.id, x.account_id])),
      });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const reqRows = reqLogs.filter((l) => {
    if (reqStatus !== "all" && l.status !== reqStatus) return false;
    if (reqType !== "all" && l.request_type !== reqType) return false;
    const hay =
      `${l.request_model} ${l.upstream_model} ${l.request_path} ${l.request_ip} ${
        hostOf(l.upstream_url)
      }`.toLowerCase();
    return hay.indexOf(reqQ.trim().toLowerCase()) >= 0;
  });
  const sysRows = sysLogs.filter((s) => {
    if (sysTask !== "all" && s.task_type !== sysTask) return false;
    if (sysStatus !== "all" && s.status !== sysStatus) return false;
    const hay = `${TASK_LABEL[s.task_type] ?? s.task_type} ${s.message ?? ""}`
      .toLowerCase();
    return hay.indexOf(sysQ.trim().toLowerCase()) >= 0;
  });

  const okCount = reqRows.filter((l) => l.status === "success").length;
  const summary = curTab === "req"
    ? `${reqRows.length} 条 · 成功 ${okCount} · 失败 ${
      reqRows.length - okCount
    }`
    : `${sysRows.length} 条 · 失败 ${
      sysRows.filter((s) => s.status === "failed").length
    }`;

  // 沿 APIKey → 账号 → 站点 反查补全,返回三个关联对象(各为 {id,name} 或 null)
  function relsOf(s: SysLog) {
    const keyId = s.api_key_id;
    const accId = s.account_id ?? (keyId ? names.keyAcc[keyId] ?? null : null);
    const siteId = s.site_id ?? (accId ? names.accSite[accId] ?? null : null);
    const mk = (id: string | null, map: Record<string, string>) =>
      id ? { id, name: map[id] ?? `#${id}` } : null;
    return {
      site: mk(siteId, names.sites),
      account: mk(accId, names.accounts),
      key: mk(keyId, names.keys),
    };
  }

  return (
    <>
      <div class="page-head">
        <div>
          <h1 class="page-title">日志</h1>
          <p class="page-sub">
            <span class="live-dot"></span> 实时落盘 · 点击行展开详情
          </p>
        </div>
        <div class="kbar">
          <span class="meta mono faint">{loading ? "加载中…" : summary}</span>
          <button type="button" class="btn btn-ghost btn-sm" onClick={load}>
            刷新
          </button>
        </div>
      </div>

      <div class="tabs">
        <button
          type="button"
          class={curTab === "req" ? "active" : undefined}
          onClick={() => setCurTab("req")}
        >
          请求日志 <span class="cnt">{reqRows.length}</span>
        </button>
        <button
          type="button"
          class={curTab === "sys" ? "active" : undefined}
          onClick={() => setCurTab("sys")}
        >
          系统日志 <span class="cnt">{sysRows.length}</span>
        </button>
      </div>

      {/* 请求日志 */}
      <div class={curTab === "req" ? "panel on" : "panel"}>
        <div class="filterbar">
          <div class="search">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width={2}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <input
              class="input"
              placeholder="搜索模型 / 路径 / IP / 上游"
              value={reqQ}
              onInput={(e) => setReqQ((e.target as HTMLInputElement).value)}
            />
          </div>
          <select
            class="select"
            value={reqStatus}
            onChange={(e) =>
              setReqStatus((e.target as HTMLSelectElement).value)}
          >
            <option value="all">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
          </select>
          <select
            class="select"
            value={reqType}
            onChange={(e) => setReqType((e.target as HTMLSelectElement).value)}
          >
            <option value="all">全部类型</option>
            <option value="final">最终</option>
            <option value="retry">重试</option>
          </select>
        </div>
        <section class="card">
          <div class="table-wrap">
            <table class="dtable">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>状态</th>
                  <th>类型</th>
                  <th>模型（请求 → 上游）</th>
                  <th>上游</th>
                  <th class="num">HTTP</th>
                  <th class="num">Tokens</th>
                  <th class="num">延迟</th>
                  <th>来源 IP</th>
                </tr>
              </thead>
              <tbody>
                {reqRows.length
                  ? reqRows.map((l) => (
                    <>
                      <tr
                        class={`logrow ${l.status}`}
                        onClick={() =>
                          setOpen((o) => ({ ...o, [l.id]: !o[l.id] }))}
                      >
                        <td class="tnum">{fmtTime(l.created_at)}</td>
                        <td>
                          <StatPill s={l.status} />
                        </td>
                        <td>
                          {l.request_type === "retry"
                            ? (
                              <span class="tag" style="color:var(--warn)">
                                重试
                              </span>
                            )
                            : <span class="tag">最终</span>}
                        </td>
                        <td>
                          <span class="mono">{l.request_model ?? "—"}</span>
                          {" "}
                          <span class="arrow">→</span>{" "}
                          <span class="mono muted">
                            {l.upstream_model ?? "—"}
                          </span>
                        </td>
                        <td>{hostOf(l.upstream_url)}</td>
                        <td
                          class="num"
                          style={`color:${httpCol(l.http_status)}`}
                        >
                          {l.http_status ?? "—"}
                        </td>
                        <td class="num">
                          {(l.total_tokens ?? 0).toLocaleString()}
                        </td>
                        <td class="num">
                          {l.latency_ms != null ? l.latency_ms + " ms" : "—"}
                        </td>
                        <td class="tnum muted">{l.request_ip ?? "—"}</td>
                      </tr>
                      {open[l.id] && (
                        <tr class="detail-row">
                          <td colspan={9}>
                            <div class="detail-box">
                              <DI k="请求路径" v={l.request_path} />
                              <DI k="上游地址" v={l.upstream_url ?? "—"} />
                              <DI
                                k="Prompt Tokens"
                                v={(l.prompt_tokens ?? 0).toLocaleString()}
                              />
                              <DI
                                k="Completion Tokens"
                                v={(l.completion_tokens ?? 0).toLocaleString()}
                              />
                              <DI
                                k="Total Tokens"
                                v={(l.total_tokens ?? 0).toLocaleString()}
                              />
                              <DI
                                k="延迟"
                                v={l.latency_ms != null
                                  ? l.latency_ms + " ms"
                                  : "—"}
                              />
                              {l.error_message && (
                                <div class="errbox">{l.error_message}</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                  : (
                    <tr>
                      <td
                        colspan={9}
                        style="text-align:center;color:var(--faint);padding:28px"
                      >
                        {loading ? "加载中…" : "暂无请求日志"}
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* 系统日志 */}
      <div class={curTab === "sys" ? "panel on" : "panel"}>
        <div class="filterbar">
          <div class="search">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width={2}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <input
              class="input"
              placeholder="搜索任务 / 信息"
              value={sysQ}
              onInput={(e) => setSysQ((e.target as HTMLInputElement).value)}
            />
          </div>
          <select
            class="select"
            value={sysTask}
            onChange={(e) => setSysTask((e.target as HTMLSelectElement).value)}
          >
            <option value="all">全部任务</option>
            {Object.entries(TASK_LABEL).map(([k, v]) => (
              <option value={k} key={k}>{v}</option>
            ))}
          </select>
          <select
            class="select"
            value={sysStatus}
            onChange={(e) =>
              setSysStatus((e.target as HTMLSelectElement).value)}
          >
            <option value="all">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
            <option value="skipped">跳过</option>
          </select>
        </div>
        <section class="card">
          <div class="table-wrap">
            <table class="dtable">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>任务类型</th>
                  <th>状态</th>
                  <th>关联站点</th>
                  <th>关联账号</th>
                  <th>关联 APIKey</th>
                  <th>信息</th>
                </tr>
              </thead>
              <tbody>
                {sysRows.length
                  ? sysRows.map((s) => {
                    const r = relsOf(s);
                    const msgColor = s.status === "failed"
                      ? "color:var(--bad)"
                      : s.status === "skipped"
                      ? "color:var(--muted)"
                      : "";
                    // 关联对象单元格:可点击跳转上游页并选中(携带父级链使 Miller 列聚焦)
                    const relCell = (
                      kind: "site" | "account" | "key",
                      obj: { id: string; name: string } | null,
                    ) => {
                      if (!obj) return <span class="faint">—</span>;
                      const p = new URLSearchParams();
                      if (r.site) p.set("site", r.site.id);
                      if (kind !== "site" && r.account) {
                        p.set("account", r.account.id);
                      }
                      if (kind === "key" && r.key) p.set("key", r.key.id);
                      return (
                        <a
                          class="rel-link mono"
                          href={`/upstream?${p.toString()}`}
                        >
                          {obj.name}
                        </a>
                      );
                    };
                    return (
                      <tr key={s.id}>
                        <td class="tnum">{fmtTime(s.created_at)}</td>
                        <td>{TASK_LABEL[s.task_type] ?? s.task_type}</td>
                        <td>
                          <TaskStat s={s.status} />
                        </td>
                        <td>{relCell("site", r.site)}</td>
                        <td>{relCell("account", r.account)}</td>
                        <td>{relCell("key", r.key)}</td>
                        <td
                          style={`font-family:var(--font-mono);font-size:12px;${msgColor}`}
                        >
                          {s.message ?? "—"}
                        </td>
                      </tr>
                    );
                  })
                  : (
                    <tr>
                      <td
                        colspan={7}
                        style="text-align:center;color:var(--faint);padding:28px"
                      >
                        {loading ? "加载中…" : "暂无系统日志"}
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
