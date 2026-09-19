import {
  formatPerfLatency,
  formatPerfTps,
  perfLevel,
  perfTooltip,
  type UpstreamPerf,
} from "./perf.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message ?? "assertEquals"}: expected ${
        JSON.stringify(expected)
      }, got ${JSON.stringify(actual)}`,
    );
  }
}

const ok: UpstreamPerf = {
  state: "ok",
  slots: [0, 100, 76.63],
  summary: { avg_latency_ms: 22276, success_rate: 76.63, avg_tps: 24.42 },
};

Deno.test("perfLevel grades rates by the new-api thresholds", () => {
  assertEquals(perfLevel(100), "ok");
  assertEquals(perfLevel(90), "ok");
  assertEquals(perfLevel(89.99), "warn");
  assertEquals(perfLevel(70), "warn");
  assertEquals(perfLevel(69.99), "bad");
  assertEquals(perfLevel(0), "bad");
  assertEquals(perfLevel(null), "empty");
  assertEquals(perfLevel(undefined), "empty");
  assertEquals(perfLevel(Number.NaN), "empty");
});

Deno.test("perf tooltip formats latency and throughput like new-api", () => {
  assertEquals(formatPerfLatency(22276), "22.28s");
  assertEquals(formatPerfLatency(582), "582ms");
  assertEquals(formatPerfLatency(0), "—");
  assertEquals(formatPerfLatency(Number.NaN), "—");
  assertEquals(formatPerfTps(24.42), "24.4 t/s");
  assertEquals(formatPerfTps(2.5), "2.50 t/s");
  assertEquals(formatPerfTps(205.61), "205.6 t/s");
  assertEquals(formatPerfTps(1500), "1.5K t/s");
  assertEquals(formatPerfTps(0), "—");
});

Deno.test("perf tooltip renders the v2 summary line", () => {
  assertEquals(
    perfTooltip(ok),
    "近 24 小时 · 成功率 76.63% · 延迟 22.28s · 吞吐 24.4 t/s",
  );
});

Deno.test("perf tooltip flags legacy bars and empty recent slots", () => {
  assertEquals(
    perfTooltip({ ...ok, legacy: true }),
    "近 24 小时 · 成功率 76.63% · 延迟 22.28s · 吞吐 24.4 t/s" +
      " · 旧版站点:柱为最近有流量的时段",
  );
  assertEquals(
    perfTooltip({
      state: "ok",
      slots: [null, null, null],
      summary: { avg_latency_ms: 582, success_rate: 0, avg_tps: 0 },
    }),
    "近 24 小时 · 成功率 0.00% · 延迟 582ms · 吞吐 — · 最近 3 个时段均无请求",
  );
});

Deno.test("perf tooltip explains every site-level failure state", () => {
  assertEquals(
    perfTooltip({ state: "no_data", slots: [null, null, null] }),
    "近 24 小时无该模型的请求数据",
  );
  assertEquals(
    perfTooltip({ state: "unsupported", slots: [null, null, null] }),
    "站点不支持性能数据(旧版 new-api)",
  );
  assertEquals(
    perfTooltip({
      state: "unauthorized",
      slots: [null, null, null],
      detail: "HTTP 403",
    }),
    "站点未开放性能数据(需要登录)",
  );
  assertEquals(
    perfTooltip({
      state: "error",
      slots: [null, null, null],
      detail: "HTTP 500",
    }),
    "性能数据获取失败(HTTP 500)",
  );
  assertEquals(
    perfTooltip({ state: "pending", slots: [null, null, null] }),
    "性能数据待同步",
  );
  assertEquals(perfTooltip(undefined), "性能数据待同步");
});
