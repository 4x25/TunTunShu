// 上游模型行迷你柱状图的纯逻辑(文案与配色),与渲染分离以便测试。

/** 服务端 `GET /api/upstream-models?withPerf=1` 在每行透出的性能数据。 */
export interface UpstreamPerf {
  state:
    | "ok"
    | "no_data"
    | "unsupported"
    | "unauthorized"
    | "error"
    | "pending";
  slots: (number | null)[];
  summary?: {
    avg_latency_ms: number;
    success_rate: number;
    avg_tps: number;
  };
  legacy?: boolean;
  detail?: string;
}

/** 成功率分级:≥90 正常、≥70 警告、其余异常;null 表示该时段无数据。 */
export type PerfLevel = "ok" | "warn" | "bad" | "empty";

export function perfLevel(rate: number | null | undefined): PerfLevel {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return "empty";
  }
  if (rate >= 90) return "ok";
  if (rate >= 70) return "warn";
  return "bad";
}

/** 延迟:与 new-api 同规则(≥1s 用秒并保留两位)。 */
export function formatPerfLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

/** 吞吐:≥1000 用 K 简写,<10 保留两位,其余一位。 */
export function formatPerfTps(tps: number): string {
  if (!Number.isFinite(tps) || tps <= 0) return "—";
  if (tps >= 1000) return `${(tps / 1000).toFixed(1)}K t/s`;
  return `${tps.toFixed(tps < 10 ? 2 : 1)} t/s`;
}

function formatRate(rate: number): string {
  return `${rate.toFixed(2)}%`;
}

/**
 * 柱状图悬浮文案。
 * - ok:近 24 小时的成功率/延迟/吞吐汇总(旧版站点额外说明柱的含义);
 * - 其余状态给出站点级原因(不支持 / 未开放 / 获取失败 / 待同步)。
 */
export function perfTooltip(perf: UpstreamPerf | undefined): string {
  if (!perf) return "性能数据待同步";
  switch (perf.state) {
    case "ok": {
      const summary = perf.summary;
      const parts = [
        "近 24 小时",
        `成功率 ${formatRate(summary?.success_rate ?? 0)}`,
        `延迟 ${formatPerfLatency(summary?.avg_latency_ms ?? 0)}`,
        `吞吐 ${formatPerfTps(summary?.avg_tps ?? 0)}`,
      ];
      const stale = perf.slots.some((slot) => slot !== null)
        ? ""
        : " · 最近 3 个时段均无请求";
      const legacy = perf.legacy ? " · 旧版站点:柱为最近有流量的时段" : "";
      return `${parts.join(" · ")}${stale}${legacy}`;
    }
    case "no_data":
      return "近 24 小时无该模型的请求数据";
    case "unsupported":
      return "站点不支持性能数据(旧版 new-api)";
    case "unauthorized":
      return "站点未开放性能数据(需要登录)";
    case "error":
      return `性能数据获取失败${perf.detail ? `(${perf.detail})` : ""}`;
    default:
      return "性能数据待同步";
  }
}
