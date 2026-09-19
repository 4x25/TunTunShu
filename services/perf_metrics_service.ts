import { NewApiAdapter } from "../adapters/new_api_adapter.ts";
import { getSql } from "../db/client.ts";

const adapter = new NewApiAdapter();

/** 迷你柱状图固定展示的槽数(近 3 个小时时段)。 */
export const PERF_SLOT_COUNT = 3;
/** 查询窗口:近 24 小时。 */
export const PERF_HOURS = 24;
/** 上游请求超时,与站点健康检查一致。 */
const PERF_TIMEOUT_MS = 10_000;
const HOUR_SECONDS = 3600;

/** 站点性能数据的抓取结果;落库到 sites.perf_metrics 并透出给前端。 */
export type SitePerfState = "ok" | "unsupported" | "unauthorized" | "error";

export interface PerfModelEntry {
  model_name: string;
  avg_latency_ms: number;
  success_rate: number;
  avg_tps: number;
  /** 新版 new-api:每个有流量的整点小时一个点(含 ts)。 */
  recent_success_series?: { ts: number; success_rate: number }[];
  /** 旧版 new-api:最近 ≤3 个有流量时段,无时间戳。 */
  recent_success_rates?: number[];
}

export interface SitePerfCache {
  ok: boolean;
  hours: number;
  fetched_at: string;
  window_start?: number;
  window_end?: number;
  models?: PerfModelEntry[];
  reason?: SitePerfState;
  http_status?: number;
  /** 传输层错误文本(超时/连接失败等),仅在无 HTTP 状态码时用于说明原因。 */
  error?: string;
}

/** 站点最近一次 /api/perf-metrics/summary 的原始业务分类。 */
export interface SitePerfFetchResult {
  state: SitePerfState;
  httpStatus?: number;
  cache: SitePerfCache;
}

/**
 * 传输层错误文本可能带完整 URL(站点 origin 允许写成 `https://user:pass@host`),
 * 落库/展示前先抹掉 URL 里的 userinfo,避免把凭据带进缓存与 tooltip。
 */
export function sanitizeErrorText(message: string): string {
  return message.replace(/:\/\/[^/@\s]*@/g, "://");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 归一化一个上游模型条目。上游字段随版本浮动,只保留白名单字段与有限数值,
 * 结构对不上时返回 null(该条目整体丢弃,不写脏数据)。
 */
function normalizeModel(raw: unknown): PerfModelEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const name = text(record.model_name);
  if (!name) return null;
  const entry: PerfModelEntry = {
    model_name: name,
    avg_latency_ms: optionalNumber(record.avg_latency_ms) ?? 0,
    success_rate: optionalNumber(record.success_rate) ?? 0,
    avg_tps: optionalNumber(record.avg_tps) ?? 0,
  };
  const series = record.recent_success_series;
  if (Array.isArray(series)) {
    const points: { ts: number; success_rate: number }[] = [];
    for (const point of series) {
      if (typeof point !== "object" || point === null) continue;
      const item = point as Record<string, unknown>;
      const ts = optionalNumber(item.ts);
      const rate = optionalNumber(item.success_rate);
      if (ts === undefined || rate === undefined) continue;
      points.push({ ts, success_rate: rate });
    }
    if (points.length) {
      points.sort((a, b) => a.ts - b.ts);
      entry.recent_success_series = points;
    }
  }
  const rates = record.recent_success_rates;
  if (Array.isArray(rates)) {
    const values = rates.filter(isFiniteNumber);
    if (values.length) {
      entry.recent_success_rates = values.slice(-PERF_SLOT_COUNT);
    }
  }
  return entry;
}

/**
 * 把一次上游响应归一化成落库缓存。
 * - 2xx + `success:true` + `data.models` 为数组 → ok;
 * - 404/405(旧版 new-api 没有该路由)→ unsupported;
 * - 401/403(pricing 模块要求登录/被禁用)→ unauthorized;
 * - 其余(5xx、非 JSON、业务失败、网络异常)→ error。
 */
export function buildSitePerfCache(
  response: Response | null,
  body: unknown,
  fetchedAt: string,
  error?: string,
): SitePerfFetchResult {
  if (!response) {
    return {
      state: "error",
      cache: {
        ok: false,
        hours: PERF_HOURS,
        fetched_at: fetchedAt,
        reason: "error",
        ...(error ? { error } : {}),
      },
    };
  }
  const httpStatus = response.status;
  if (httpStatus === 404 || httpStatus === 405) {
    return {
      state: "unsupported",
      httpStatus,
      cache: {
        ok: false,
        hours: PERF_HOURS,
        fetched_at: fetchedAt,
        reason: "unsupported",
        http_status: httpStatus,
      },
    };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      state: "unauthorized",
      httpStatus,
      cache: {
        ok: false,
        hours: PERF_HOURS,
        fetched_at: fetchedAt,
        reason: "unauthorized",
        http_status: httpStatus,
      },
    };
  }
  const failed = (status?: number): SitePerfFetchResult => ({
    state: "error",
    httpStatus: status,
    cache: {
      ok: false,
      hours: PERF_HOURS,
      fetched_at: fetchedAt,
      reason: "error",
      ...(status === undefined ? {} : { http_status: status }),
    },
  });
  if (!response.ok) return failed(httpStatus);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return failed(httpStatus);
  }
  const payload = body as Record<string, unknown>;
  if (payload.success !== true) return failed(httpStatus);
  const data = payload.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return failed(httpStatus);
  }
  const dataRecord = data as Record<string, unknown>;
  if (!Array.isArray(dataRecord.models)) return failed(httpStatus);
  const models: PerfModelEntry[] = [];
  for (const raw of dataRecord.models) {
    const model = normalizeModel(raw);
    if (model) models.push(model);
  }
  // 上游报成功但整段不可解析:按失败处理,避免把「有数据」的假象写进缓存。
  if (models.length === 0 && dataRecord.models.length > 0) {
    return failed(httpStatus);
  }
  const windowStart = optionalNumber(dataRecord.window_start);
  const windowEnd = optionalNumber(dataRecord.window_end);
  return {
    state: "ok",
    httpStatus,
    cache: {
      ok: true,
      hours: PERF_HOURS,
      fetched_at: fetchedAt,
      ...(windowStart === undefined ? {} : { window_start: windowStart }),
      ...(windowEnd === undefined ? {} : { window_end: windowEnd }),
      models,
    },
  };
}

/**
 * 拉取站点性能数据。优先用该站点下任意一个启用账号的用户级鉴权(需登录的站点),
 * 401/403 时再匿名重试一次(pricing 模块公开时匿名可读)。任何异常都不抛出。
 */
export async function fetchSitePerfMetrics(
  siteId: number,
  origin: string,
): Promise<SitePerfFetchResult> {
  const fetchedAt = new Date().toISOString();
  let auth: { userId: string; accessToken: string } | undefined;
  try {
    const sql = getSql();
    const rows = await sql<{ user_id: string; access_token: string }[]>`
      select user_id, access_token from accounts
      where site_id = ${siteId}
      order by enabled desc, random()
      limit 1
    `;
    const row = rows[0];
    if (row) auth = { userId: row.user_id, accessToken: row.access_token };
  } catch {
    auth = undefined;
  }

  const attempt = async (
    withAuth: boolean,
  ): Promise<{ response: Response | null; body: unknown; error?: string }> => {
    try {
      const response = await adapter.getPerfMetricsSummary(
        origin,
        PERF_HOURS,
        withAuth ? { origin, ...auth! } : undefined,
        AbortSignal.timeout(PERF_TIMEOUT_MS),
      );
      const body = await response.json().catch(() => null);
      return { response, body };
    } catch (error) {
      return {
        response: null,
        body: null,
        error: sanitizeErrorText(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  };

  const first = await attempt(Boolean(auth));
  const needsAnonymousRetry = auth &&
    (first.response?.status === 401 || first.response?.status === 403);
  if (needsAnonymousRetry) {
    await first.response?.body?.cancel().catch(() => undefined);
    const anonymous = await attempt(false);
    return buildSitePerfCache(
      anonymous.response,
      anonymous.body,
      fetchedAt,
      anonymous.error,
    );
  }
  return buildSitePerfCache(first.response, first.body, fetchedAt, first.error);
}

/** 站点缓存里该模型的性能条目;站点未同步/该模型无数据时为 null。 */
export function findPerfModel(
  cache: SitePerfCache | null | undefined,
  modelName: string,
): PerfModelEntry | null {
  if (!cache?.ok || !Array.isArray(cache.models)) return null;
  return cache.models.find((model) => model.model_name === modelName) ?? null;
}

/**
 * 把该模型的成功率对齐到最近 PERF_SLOT_COUNT 个整点小时槽(右对齐,缺失为 null)。
 * 新版按 ts 精确落槽(无流量的时段留空);旧版没有时间戳,只能把最后几个值右对齐。
 */
export function perfSlots(
  entry: PerfModelEntry,
  windowEnd?: number,
): { slots: (number | null)[]; legacy: boolean } {
  const series = entry.recent_success_series;
  if (Array.isArray(series) && series.length > 0) {
    const end = windowEnd ?? series[series.length - 1].ts;
    const alignedEnd = end - (end % HOUR_SECONDS);
    const byHour = new Map<number, number>();
    for (const point of series) {
      const hour = point.ts - (point.ts % HOUR_SECONDS);
      byHour.set(hour, point.success_rate);
    }
    const slots: (number | null)[] = [];
    for (let index = PERF_SLOT_COUNT - 1; index >= 0; index -= 1) {
      const hour = alignedEnd - index * HOUR_SECONDS;
      slots.push(byHour.get(hour) ?? null);
    }
    return { slots, legacy: false };
  }
  const rates = entry.recent_success_rates ?? [];
  const slots: (number | null)[] = Array.from(
    { length: PERF_SLOT_COUNT },
    () => null,
  );
  const tail = rates.slice(-PERF_SLOT_COUNT);
  for (let index = 0; index < tail.length; index += 1) {
    slots[PERF_SLOT_COUNT - tail.length + index] = tail[index];
  }
  return { slots, legacy: true };
}

/** 行级展示状态:站点抓取态 + 「模型无数据」「尚未同步」。 */
export type RowPerfState = SitePerfState | "no_data" | "pending";

/** 上游模型行透出的性能数据(对应 UpstreamModelColumn 的迷你柱状图)。 */
export interface RowPerf {
  state: RowPerfState;
  slots: (number | null)[];
  summary?: { avg_latency_ms: number; success_rate: number; avg_tps: number };
  legacy?: boolean;
  detail?: string;
}

function emptySlots(): (number | null)[] {
  return Array.from({ length: PERF_SLOT_COUNT }, () => null);
}

/** 站点缓存的失败原因 → 行级状态文案里的细节(HTTP 码优先,其次传输层错误)。 */
function failureDetail(cache: SitePerfCache): string | undefined {
  if (cache.http_status !== undefined) return `HTTP ${cache.http_status}`;
  if (cache.error) return cache.error;
  return undefined;
}

/**
 * 把站点级性能缓存折叠成单个上游模型行的展示数据。
 * 站点没有缓存(从未同步)→ pending;抓取失败 → 站点级失败态;站点成功但列表里
 * 没有该模型 → no_data;命中 → ok + 最近 3 槽 + 汇总数值。
 */
export function buildRowPerf(
  cache: SitePerfCache | null | undefined,
  modelName: string,
): RowPerf {
  if (!cache) {
    return { state: "pending", slots: emptySlots() };
  }
  if (cache.ok !== true) {
    const state: RowPerfState = cache.reason ?? "error";
    const detail = failureDetail(cache);
    return { state, slots: emptySlots(), ...(detail ? { detail } : {}) };
  }
  const entry = findPerfModel(cache, modelName);
  if (!entry) {
    return { state: "no_data", slots: emptySlots() };
  }
  const { slots, legacy } = perfSlots(entry, cache.window_end);
  return {
    state: "ok",
    slots,
    summary: {
      avg_latency_ms: entry.avg_latency_ms,
      success_rate: entry.success_rate,
      avg_tps: entry.avg_tps,
    },
    ...(legacy ? { legacy: true } : {}),
  };
}
