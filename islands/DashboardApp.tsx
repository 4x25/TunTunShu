import { useEffect, useRef, useState } from "preact/hooks";
import { IconRefresh } from "../components/icons.tsx";
import { apiGet } from "../components/admin_api.ts";

interface TrendPoint {
  label: string;
  success: number;
  fail: number;
}
interface Dashboard {
  accounts: { total: number };
  apiKeys: { total: number };
  models: { total: number; upstream: number; routable: number };
  today: {
    total: number;
    success: number;
    failed: number;
    successRate: number;
    tokens: number;
    p50LatencyMs: number;
  };
  trend: TrendPoint[];
  siteList: {
    id: string;
    name: string;
    origin: string;
    status: string;
    enabled: boolean;
  }[];
  recentTasks: {
    task_type: string;
    status: string;
    message: string | null;
    created_at: string;
  }[];
}

interface Geo {
  padL: number;
  step: number;
  base: number;
  top: number;
  n: number;
  W: number;
  success: number[];
  fail: number[];
  labels: string[];
}
interface Tip {
  label: string;
  s: number;
  f: number;
  rate: number;
  left: number;
  top: number;
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

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * p;
}
function relTime(iso: string): string {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
    return Math.floor(diff / 86400) + " 天前";
  } catch {
    return "";
  }
}

function SitePill({ st }: { st: string }) {
  if (st === "healthy") {
    return (
      <span class="pill pill-ok">
        <span class="dot"></span>正常
      </span>
    );
  }
  if (st === "down") {
    return (
      <span class="pill pill-bad">
        <span class="dot"></span>异常
      </span>
    );
  }
  return (
    <span class="pill pill-mute">
      <span class="dot"></span>未知
    </span>
  );
}
function TaskPill({ st }: { st: string }) {
  if (st === "success") return <span class="pill pill-ok">成功</span>;
  if (st === "failed") return <span class="pill pill-bad">失败</span>;
  return <span class="pill pill-mute">跳过</span>;
}

export default function DashboardApp() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [tip, setTip] = useState<Tip | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const geoRef = useRef<Geo | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<Dashboard | null>(null);
  dataRef.current = data;

  async function load() {
    setLoading(true);
    try {
      setData(await apiGet<Dashboard>("/dashboard"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function paint() {
    const svg = svgRef.current;
    const d = dataRef.current;
    if (!svg || !d) return;
    const SUCCESS = d.trend.map((t) => t.success);
    const FAIL = d.trend.map((t) => t.fail);
    const labels = d.trend.map((t) => t.label);
    const n = SUCCESS.length;
    if (!n) return;
    const cs = getComputedStyle(document.documentElement);
    const c = (k: string) => cs.getPropertyValue(k).trim();
    const COL = {
      ok: c("--ok"),
      bad: c("--bad"),
      line: c("--accent"),
      grid: c("--border"),
      faint: c("--faint"),
    };
    const W = 980, H = 320, pad = { t: 14, r: 48, b: 30, l: 46 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, base = pad.t + ih;
    const step = iw / n, bw = Math.min(46, step * 0.62);
    const totals = SUCCESS.map((s, i) => s + FAIL[i]);
    const maxT = niceMax(Math.max(1, ...totals));
    const every = Math.max(1, Math.round(n / 8));
    const rateMin = 80;
    const p: string[] = [];

    for (let g = 0; g <= 4; g++) {
      const val = maxT * g / 4, y = base - (ih * g / 4);
      p.push(
        `<line x1="${pad.l}" y1="${y}" x2="${
          W - pad.r
        }" y2="${y}" stroke="${COL.grid}" stroke-width="1"/>`,
      );
      p.push(
        `<text x="${pad.l - 8}" y="${
          y + 4
        }" text-anchor="end" font-size="11" fill="${COL.faint}" font-family="ui-monospace,monospace">${
          Math.round(val)
        }</text>`,
      );
    }
    [80, 90, 100].forEach((rv) => {
      const y = pad.t + (1 - (rv - rateMin) / (100 - rateMin)) * ih;
      p.push(
        `<text x="${W - pad.r + 8}" y="${
          y + 4
        }" text-anchor="start" font-size="11" fill="${COL.line}" font-family="ui-monospace,monospace">${rv}%</text>`,
      );
    });
    for (let i = 0; i < n; i++) {
      const x = pad.l + step * i + (step - bw) / 2;
      const sh = SUCCESS[i] / maxT * ih, fh = FAIL[i] / maxT * ih;
      p.push(
        `<rect x="${x.toFixed(1)}" y="${(base - sh).toFixed(1)}" width="${
          bw.toFixed(1)
        }" height="${
          Math.max(sh, 0).toFixed(1)
        }" fill="${COL.ok}" rx="1.5" opacity="0.92"/>`,
      );
      if (FAIL[i] > 0) {
        p.push(
          `<rect x="${x.toFixed(1)}" y="${
            (base - sh - fh).toFixed(1)
          }" width="${bw.toFixed(1)}" height="${
            Math.max(fh, 1).toFixed(1)
          }" fill="${COL.bad}" rx="1.5"/>`,
        );
      }
      if (i % every === 0) {
        p.push(
          `<text x="${(x + bw / 2).toFixed(1)}" y="${
            base + 18
          }" text-anchor="middle" font-size="10.5" fill="${COL.faint}" font-family="ui-monospace,monospace">${
            labels[i]
          }</text>`,
        );
      }
    }
    const pts: [number, number][] = [];
    for (let j = 0; j < n; j++) {
      let rate = totals[j] ? SUCCESS[j] / totals[j] * 100 : 100;
      rate = Math.max(rate, rateMin);
      pts.push([
        pad.l + step * j + step / 2,
        pad.t + (1 - (rate - rateMin) / (100 - rateMin)) * ih,
      ]);
    }
    p.push(
      `<path d="${
        pts.map((pt, k) =>
          (k ? "L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1)
        ).join(" ")
      }" fill="none" stroke="${COL.line}" stroke-width="2" stroke-linejoin="round"/>`,
    );
    pts.forEach((pt) =>
      p.push(
        `<circle cx="${pt[0].toFixed(1)}" cy="${
          pt[1].toFixed(1)
        }" r="2.6" fill="${COL.line}"/>`,
      )
    );
    p.push(
      `<line id="cross" x1="0" y1="${pad.t}" x2="0" y2="${base}" stroke="${COL.faint}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`,
    );

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.innerHTML = p.join("");
    geoRef.current = {
      padL: pad.l,
      step,
      base,
      top: pad.t,
      n,
      W,
      success: SUCCESS,
      fail: FAIL,
      labels,
    };
  }

  useEffect(() => {
    if (data) paint();
    // eslint-disable-next-line
  }, [data]);
  useEffect(() => {
    const onTheme = () => paint();
    document.addEventListener("themechange", onTheme);
    return () => document.removeEventListener("themechange", onTheme);
  }, []);

  function onMove(e: MouseEvent) {
    const geo = geoRef.current, svg = svgRef.current, stage = stageRef.current;
    if (!geo || !svg || !stage) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const sx = geo.W / rect.width;
    let idx = Math.round(
      ((e.clientX - rect.left) * sx - geo.padL - geo.step / 2) / geo.step,
    );
    idx = Math.max(0, Math.min(geo.n - 1, idx));
    const cx = geo.padL + geo.step * idx + geo.step / 2;
    const cross = svg.querySelector("#cross");
    if (cross) {
      cross.setAttribute("x1", String(cx));
      cross.setAttribute("x2", String(cx));
      cross.setAttribute("opacity", "1");
    }
    const s = geo.success[idx], f = geo.fail[idx], tot = s + f;
    const sr = stage.getBoundingClientRect();
    setTip({
      label: geo.labels[idx],
      s,
      f,
      rate: tot ? s / tot * 100 : 100,
      left: Math.max(66, Math.min(sr.width - 66, e.clientX - sr.left)),
      top: Math.max(6, e.clientY - sr.top - 12),
    });
  }
  function onLeave() {
    setTip(null);
    const cross = svgRef.current?.querySelector("#cross");
    if (cross) cross.setAttribute("opacity", "0");
  }

  const today = data?.today;

  return (
    <>
      <div class="page-head">
        <div>
          <h1 class="page-title">仪表盘</h1>
          <p class="page-sub">实例运行概况 · 数据来自真实请求日志</p>
        </div>
        <div class="kbar">
          <span class="tag">近 24 小时</span>
          <button type="button" class="btn btn-ghost btn-sm" onClick={load}>
            <IconRefresh />
            刷新
          </button>
        </div>
      </div>

      <section class="stat-grid" style="margin-bottom:14px">
        <div class="stat-tile">
          <span class="k">今日请求数</span>
          <span class="v">{(today?.total ?? 0).toLocaleString()}</span>
          <span class="d trend-flat">
            成功 {today?.success ?? 0} · 失败 {today?.failed ?? 0}
          </span>
        </div>
        <div class="stat-tile">
          <span class="k">成功率（今日）</span>
          <span class="v">
            {today?.successRate ?? 100}
            <small>%</small>
          </span>
          <span class="d trend-flat">基于今日请求</span>
        </div>
        <div class="stat-tile">
          <span class="k">平均延迟 P50</span>
          <span class="v">
            {today?.p50LatencyMs ?? 0}
            <small>ms</small>
          </span>
          <span class="d trend-flat">今日中位延迟</span>
        </div>
        <div class="stat-tile">
          <span class="k">今日 Tokens</span>
          <span class="v">{(today?.tokens ?? 0).toLocaleString()}</span>
          <span class="d trend-flat">
            可路由模型 {data?.models.routable ?? 0}
          </span>
        </div>
      </section>

      <div class="dash-grid">
        <section class="card chart-card">
          <div class="card-head">
            <h3>请求成功率趋势 · 按小时</h3>
            <div class="legend">
              <span>
                <i style="background:var(--ok)"></i>成功
              </span>
              <span>
                <i style="background:var(--bad)"></i>失败
              </span>
              <span>
                <i class="ln" style="background:var(--accent)"></i>成功率 %
              </span>
            </div>
          </div>
          <div class="chart-box">
            <div class="chart-stage" ref={stageRef}>
              <svg
                ref={svgRef}
                role="img"
                aria-label="近 24 小时请求成功/失败堆叠柱状图与成功率折线"
                onMouseMove={onMove}
                onMouseLeave={onLeave}
              >
              </svg>
              {tip && (
                <div
                  class="chart-tip"
                  style={`left:${tip.left}px;top:${tip.top}px`}
                >
                  <b>{tip.label}</b>
                  <div class="row">
                    <span>成功</span>
                    <b style="color:var(--ok)">{tip.s.toLocaleString()}</b>
                  </div>
                  <div class="row">
                    <span>失败</span>
                    <b style="color:var(--bad)">{tip.f.toLocaleString()}</b>
                  </div>
                  <div class="row">
                    <span>成功率</span>
                    <b style="color:var(--accent)">{tip.rate.toFixed(1)}%</b>
                  </div>
                </div>
              )}
              {loading && (
                <div class="chart-state">
                  <div class="chart-load">
                    <span class="spinner"></span>正在加载…
                  </div>
                </div>
              )}
              {!loading && data && data.today.total === 0 && (
                <div class="chart-state">
                  <div class="chart-empty">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M3 3v18h18" />
                      <path d="M7 14l3-3 3 3 4-5" />
                    </svg>
                    今日暂无请求,通过 /v1 调用后这里会显示趋势
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <div class="sub-grid">
          <section class="card">
            <div class="card-head">
              <h3>上游站点状态</h3>
              <a class="more-link" href="/upstream">查看全部 →</a>
            </div>
            <div class="mini-list">
              {(data?.siteList ?? []).length
                ? data!.siteList.map((s) => (
                  <div class="mini-row" key={s.id}>
                    <div>
                      <div class="name">{s.name}</div>
                      <div class="meta">{s.origin}</div>
                    </div>
                    <div class="right">
                      <SitePill st={s.status} />
                    </div>
                  </div>
                ))
                : (
                  <div class="empty" style="padding:20px">
                    {loading ? "加载中…" : "暂无站点"}
                  </div>
                )}
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h3>最近系统任务</h3>
              <a class="more-link" href="/logs">日志 →</a>
            </div>
            <div class="mini-list">
              {(data?.recentTasks ?? []).length
                ? data!.recentTasks.map((t, i) => (
                  <div class="mini-row" key={i}>
                    <div class="name">
                      {TASK_LABEL[t.task_type] ?? t.task_type}
                    </div>
                    <div
                      class="right"
                      style="display:flex;align-items:center;gap:10px"
                    >
                      <span class="meta">{relTime(t.created_at)}</span>
                      <TaskPill st={t.status} />
                    </div>
                  </div>
                ))
                : (
                  <div class="empty" style="padding:20px">
                    {loading ? "加载中…" : "暂无系统任务"}
                  </div>
                )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
