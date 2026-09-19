import {
  buildRowPerf,
  buildSitePerfCache,
  findPerfModel,
  type PerfModelEntry,
  perfSlots,
  sanitizeErrorText,
  type SitePerfCache,
} from "./perf_metrics_service.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${message ?? "assertEquals"}: ${left} !== ${right}`);
  }
}

const FETCHED_AT = "2026-09-19T03:00:00.000Z";
const HOUR = 3600;

function response(status: number): Response {
  return new Response(null, { status });
}

function okBody(extra: Record<string, unknown> = {}, models: unknown[] = []) {
  return { success: true, data: { models, ...extra } };
}

const seriesPayload = {
  success: true,
  data: {
    window_start: 1_700_000_000,
    window_end: 1_700_003_600 * 6,
    models: [
      {
        model_name: "gpt-5.6-sol",
        avg_latency_ms: 22276,
        success_rate: 76.63,
        avg_tps: 24.42,
        recent_success_series: [
          { ts: 1_700_003_600 * 6 - 2 * HOUR, success_rate: 0 },
          { ts: 1_700_003_600 * 6 - HOUR, success_rate: 100 },
          { ts: 1_700_003_600 * 6, success_rate: 42.5 },
        ],
      },
    ],
  },
};

Deno.test("buildSitePerfCache classifies HTTP failures", () => {
  assertEquals(
    buildSitePerfCache(response(404), null, FETCHED_AT).state,
    "unsupported",
    "old new-api has no route → 404",
  );
  assertEquals(
    buildSitePerfCache(response(405), null, FETCHED_AT).state,
    "unsupported",
  );
  assertEquals(
    buildSitePerfCache(response(401), null, FETCHED_AT).state,
    "unauthorized",
  );
  assertEquals(
    buildSitePerfCache(response(403), null, FETCHED_AT).state,
    "unauthorized",
  );
  assertEquals(
    buildSitePerfCache(response(500), null, FETCHED_AT).state,
    "error",
  );
  assertEquals(
    buildSitePerfCache(null, null, FETCHED_AT, "timeout").state,
    "error",
    "transport failure",
  );
  assertEquals(
    buildSitePerfCache(null, null, FETCHED_AT, "The operation timed out").cache
      .error,
    "The operation timed out",
    "transport errors keep their message for the tooltip",
  );
  assertEquals(
    buildSitePerfCache(
      response(200),
      { success: false, data: null },
      FETCHED_AT,
    )
      .state,
    "error",
    "business failure",
  );
  assertEquals(
    buildSitePerfCache(response(200), null, FETCHED_AT).state,
    "error",
    "non-JSON body",
  );
});

Deno.test("buildSitePerfCache keeps failure details for the tooltip", () => {
  const unauthorized = buildSitePerfCache(response(403), null, FETCHED_AT);
  assertEquals(unauthorized.cache.reason, "unauthorized");
  assertEquals(unauthorized.cache.http_status, 403);
  assertEquals(unauthorized.cache.ok, false);
  const unsupported = buildSitePerfCache(response(404), null, FETCHED_AT);
  assertEquals(unsupported.cache.reason, "unsupported");
  assertEquals(unsupported.cache.http_status, 404);
});

Deno.test("sanitizeErrorText strips credentials from URLs", () => {
  assertEquals(
    sanitizeErrorText(
      "error sending request for url (https://alice:sekret@site.example/api/perf-metrics/summary?hours=24)",
    ),
    "error sending request for url (https://site.example/api/perf-metrics/summary?hours=24)",
  );
  assertEquals(
    sanitizeErrorText("The operation timed out"),
    "The operation timed out",
  );
});

Deno.test("buildSitePerfCache normalizes a v2 (series) payload", () => {
  const result = buildSitePerfCache(
    response(200),
    seriesPayload,
    FETCHED_AT,
  );
  assertEquals(result.state, "ok");
  assertEquals(result.cache.ok, true);
  assertEquals(result.cache.hours, 24);
  assertEquals(result.cache.fetched_at, FETCHED_AT);
  assertEquals(result.cache.window_end, 1_700_003_600 * 6);
  assertEquals(result.cache.models?.length, 1);
  assertEquals(result.cache.models?.[0], {
    model_name: "gpt-5.6-sol",
    avg_latency_ms: 22276,
    success_rate: 76.63,
    avg_tps: 24.42,
    recent_success_series: [
      { ts: 1_700_003_600 * 6 - 2 * HOUR, success_rate: 0 },
      { ts: 1_700_003_600 * 6 - HOUR, success_rate: 100 },
      { ts: 1_700_003_600 * 6, success_rate: 42.5 },
    ],
  });
});

Deno.test("buildSitePerfCache normalizes the legacy (bare array) payload", () => {
  const result = buildSitePerfCache(
    response(200),
    okBody({}, [
      {
        model_name: "deepseek-v4-flash",
        avg_latency_ms: 42818,
        success_rate: 81.87,
        avg_tps: 89.82,
        recent_success_rates: [96.1, 96.17, 0],
      },
      {
        model_name: "glm-5.3",
        avg_latency_ms: 31565,
        success_rate: 54.52,
        avg_tps: 79.2,
        recent_success_rates: [84.13, 5.06, 0],
      },
    ]),
    FETCHED_AT,
  );
  assertEquals(result.state, "ok");
  assertEquals(result.cache.models?.length, 2);
  assertEquals(result.cache.models?.[0].recent_success_rates, [96.1, 96.17, 0]);
  assertEquals(result.cache.models?.[0].recent_success_series, undefined);
  assertEquals(result.cache.window_start, undefined);
});

Deno.test("buildSitePerfCache drops unparsable entries and odd shapes", () => {
  const result = buildSitePerfCache(
    response(200),
    {
      success: true,
      data: {
        models: [
          "not-an-object",
          { avg_latency_ms: 1 },
          { model_name: "", success_rate: 50 },
          { model_name: "ok", success_rate: "50", avg_latency_ms: 12 },
        ],
      },
    },
    FETCHED_AT,
  );
  assertEquals(result.state, "ok");
  assertEquals(result.cache.models, [
    { model_name: "ok", avg_latency_ms: 12, success_rate: 0, avg_tps: 0 },
  ]);
});

Deno.test("buildSitePerfCache treats an all-unparsable list as a failure", () => {
  const result = buildSitePerfCache(
    response(200),
    { success: true, data: { models: [{ nope: true }] } },
    FETCHED_AT,
  );
  assertEquals(result.state, "error");
  assertEquals(result.cache.ok, false);
});

Deno.test("buildSitePerfCache accepts an empty model list", () => {
  const result = buildSitePerfCache(response(200), okBody(), FETCHED_AT);
  assertEquals(result.state, "ok");
  assertEquals(result.cache.models, []);
});

Deno.test("perfSlots aligns a v2 series to the last 3 hour slots", () => {
  const windowEnd = 1_700_003_600 * 6;
  const entry: PerfModelEntry = {
    model_name: "gpt-6-astra",
    avg_latency_ms: 18379,
    success_rate: 46.89,
    avg_tps: 22.36,
    recent_success_series: [
      { ts: windowEnd - 5 * HOUR, success_rate: 11 },
      { ts: windowEnd - 2 * HOUR, success_rate: 0 },
      { ts: windowEnd, success_rate: 100 },
    ],
  };
  assertEquals(perfSlots(entry, windowEnd), {
    slots: [0, null, 100],
    legacy: false,
  });
});

Deno.test("perfSlots falls back to the last point when window_end is missing", () => {
  const entry: PerfModelEntry = {
    model_name: "m",
    avg_latency_ms: 1,
    success_rate: 50,
    avg_tps: 1,
    recent_success_series: [
      { ts: 1_000, success_rate: 1 },
      { ts: 1_000 + HOUR, success_rate: 2 },
      { ts: 1_000 + 2 * HOUR, success_rate: 3 },
    ],
  };
  assertEquals(perfSlots(entry, undefined), {
    slots: [1, 2, 3],
    legacy: false,
  });
});

Deno.test("perfSlots right-aligns legacy bare rates and pads with null", () => {
  assertEquals(
    perfSlots({
      model_name: "glm-5.3",
      avg_latency_ms: 1,
      success_rate: 1,
      avg_tps: 1,
      recent_success_rates: [84.13, 5.06, 0],
    }),
    { slots: [84.13, 5.06, 0], legacy: true },
  );
  assertEquals(
    perfSlots({
      model_name: "gpt-6-astra",
      avg_latency_ms: 1,
      success_rate: 1,
      avg_tps: 1,
      recent_success_rates: [15],
    }),
    { slots: [null, null, 15], legacy: true },
  );
  assertEquals(
    perfSlots({
      model_name: "no-data",
      avg_latency_ms: 1,
      success_rate: 1,
      avg_tps: 1,
    }),
    { slots: [null, null, null], legacy: true },
  );
});

Deno.test("buildRowPerf surfaces transport errors when there is no HTTP status", () => {
  assertEquals(
    buildRowPerf({
      ok: false,
      hours: 24,
      fetched_at: FETCHED_AT,
      reason: "error",
      error: "The operation timed out",
    }, "m"),
    {
      state: "error",
      slots: [null, null, null],
      detail: "The operation timed out",
    },
  );
  // 有 HTTP 状态码时优先展示状态码,不再重复错误文本。
  assertEquals(
    buildRowPerf({
      ok: false,
      hours: 24,
      fetched_at: FETCHED_AT,
      reason: "error",
      http_status: 500,
      error: "boom",
    }, "m"),
    { state: "error", slots: [null, null, null], detail: "HTTP 500" },
  );
});

Deno.test("findPerfModel matches by exact model name", () => {
  const cache: SitePerfCache = {
    ok: true,
    hours: 24,
    fetched_at: FETCHED_AT,
    models: [{
      model_name: "gpt-5.6-luna",
      avg_latency_ms: 1,
      success_rate: 1,
      avg_tps: 1,
    }],
  };
  assertEquals(
    findPerfModel(cache, "gpt-5.6-luna")?.model_name,
    "gpt-5.6-luna",
  );
  assertEquals(findPerfModel(cache, "gpt-5.6-luna:free"), null);
  assertEquals(findPerfModel(null, "gpt-5.6-luna"), null);
  assertEquals(
    findPerfModel({ ok: false, hours: 24, fetched_at: "" }, "x"),
    null,
  );
});

Deno.test("buildRowPerf maps site cache states to row states", () => {
  assertEquals(buildRowPerf(null, "m"), {
    state: "pending",
    slots: [null, null, null],
  });
  assertEquals(
    buildRowPerf({
      ok: false,
      hours: 24,
      fetched_at: FETCHED_AT,
      reason: "unsupported",
      http_status: 404,
    }, "m"),
    {
      state: "unsupported",
      slots: [null, null, null],
      detail: "HTTP 404",
    },
  );
  assertEquals(
    buildRowPerf({
      ok: false,
      hours: 24,
      fetched_at: FETCHED_AT,
      reason: "unauthorized",
    }, "m"),
    {
      state: "unauthorized",
      slots: [null, null, null],
    },
  );
  const okCache: SitePerfCache = {
    ok: true,
    hours: 24,
    fetched_at: FETCHED_AT,
    window_end: 1_700_003_600 * 6,
    models: [{
      model_name: "gpt-5.6-sol",
      avg_latency_ms: 22276,
      success_rate: 76.63,
      avg_tps: 24.42,
      recent_success_series: [
        { ts: 1_700_003_600 * 6, success_rate: 76.63 },
      ],
    }],
  };
  assertEquals(buildRowPerf(okCache, "gpt-5.6-sol"), {
    state: "ok",
    slots: [null, null, 76.63],
    summary: { avg_latency_ms: 22276, success_rate: 76.63, avg_tps: 24.42 },
  });
  assertEquals(buildRowPerf(okCache, "unknown-model"), {
    state: "no_data",
    slots: [null, null, null],
  });
  const legacyCache: SitePerfCache = {
    ok: true,
    hours: 24,
    fetched_at: FETCHED_AT,
    models: [{
      model_name: "glm-5.3",
      avg_latency_ms: 31565,
      success_rate: 54.52,
      avg_tps: 79.2,
      recent_success_rates: [84.13, 5.06, 0],
    }],
  };
  assertEquals(buildRowPerf(legacyCache, "glm-5.3"), {
    state: "ok",
    slots: [84.13, 5.06, 0],
    summary: { avg_latency_ms: 31565, success_rate: 54.52, avg_tps: 79.2 },
    legacy: true,
  });
});
