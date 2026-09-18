import {
  type AccountWithOrigin,
  executeAccountCheckin,
} from "./account_service.ts";
import type { BrowserCheckinLease } from "./browser_checkin_lease_service.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

const account: AccountWithOrigin = {
  id: 7,
  site_id: 3,
  origin: "https://upstream.example",
  user_id: "42",
  access_token: "test-secret",
};

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    init,
  );
}

function settings(enabled: boolean, timeout = "120") {
  return Promise.resolve({
    browser_checkin_enabled: String(enabled),
    browser_checkin_timeout_seconds: timeout,
  });
}

function fakeLease(
  onRelease?: () => void,
  onAbandon?: () => void,
): BrowserCheckinLease {
  return {
    acquired: true,
    owner: "test-owner",
    waitedMs: 0,
    startHeartbeat: () => () => undefined,
    release: () => {
      onRelease?.();
      return Promise.resolve();
    },
    abandon: () => onAbandon?.(),
  };
}

/**
 * 单测统一禁用「challenge 时用 GET /api/user/checkin 复核」的真实网络调用;
 * 需要该行为的用例可显式覆盖 probeCheckinDisabled。
 */
const runCheckin = (
  account: AccountWithOrigin,
  dependencies: Parameters<typeof executeAccountCheckin>[1] = {},
) =>
  executeAccountCheckin(account, {
    probeCheckinDisabled: () => Promise.resolve(false),
    ...dependencies,
  });

Deno.test("account check-in skips sites without check-in enabled", async () => {
  let directCalls = 0;
  let browserCalls = 0;
  const result = await runCheckin(
    { ...account, site_checkin_enabled: false },
    {
      loadSettings: () => settings(true),
      directCheckin: () => {
        directCalls += 1;
        return Promise.resolve(response({ success: true }));
      },
      browserCheckin: () => {
        browserCalls += 1;
        throw new Error("browser must not run");
      },
    },
  );
  assertEquals(result.checkinStatus, "unknown", "check-in status");
  assertEquals(result.taskStatus, "skipped", "task status");
  assertEquals(result.skipped, true, "skipped flag");
  assertEquals(directCalls, 0, "direct check-in call count");
  assertEquals(browserCalls, 0, "browser call count");
});

Deno.test("account check-in keeps direct success on the fast path", async () => {
  let browserCalls = 0;
  const result = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: () =>
      Promise.resolve(response({ success: true, message: "签到成功" })),
    browserCheckin: () => {
      browserCalls += 1;
      throw new Error("browser must not run");
    },
  });
  assertEquals(result.checkinStatus, "checked", "check-in status");
  assertEquals(result.checkinMethod, "direct", "check-in method");
  assertEquals(result.taskStatus, "success", "task status");
  assertEquals(browserCalls, 0, "browser call count");
});

Deno.test("account check-in does not browser-fallback ordinary failures", async () => {
  let leaseCalls = 0;
  const result = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: () =>
      Promise.resolve(response({
        success: false,
        message: "上游维护中",
      })),
    acquireLease: () => {
      leaseCalls += 1;
      return Promise.resolve({ acquired: false, waitedMs: 0 });
    },
  });
  assertEquals(result.checkinStatus, "failed", "check-in status");
  assertEquals(result.checkinMethod, "direct", "check-in method");
  assertEquals(leaseCalls, 0, "lease call count");
});

Deno.test("account check-in unmasks Turnstile-hidden disabled sites", async () => {
  // new-api 把 TurnstileCheck 挂在 POST /api/user/checkin 前面,站点未开放签到时
  // 直连只会回「Turnstile token 为空」。此时用 GET 复核,确认未开放就跳过,
  // 不启动浏览器。
  let leaseCalls = 0;
  let browserCalls = 0;
  const result = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: () =>
      Promise.resolve(response({
        success: false,
        message: "Turnstile token 为空",
      })),
    probeCheckinDisabled: () => Promise.resolve(true),
    acquireLease: () => {
      leaseCalls += 1;
      return Promise.resolve({ acquired: false, waitedMs: 0 });
    },
    browserCheckin: () => {
      browserCalls += 1;
      throw new Error("browser must not run");
    },
  });
  assertEquals(result.checkinStatus, "unknown", "check-in status");
  assertEquals(result.taskStatus, "skipped", "task status");
  assertEquals(result.skipped, true, "skipped flag");
  assertEquals(result.checkinMethod, "direct", "check-in method");
  assertEquals(leaseCalls, 0, "lease call count");
  assertEquals(browserCalls, 0, "browser call count");
});

Deno.test("account check-in treats upstream disabled reply as skipped", async () => {
  let leaseCalls = 0;
  let browserCalls = 0;
  const result = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: () =>
      Promise.resolve(response({
        success: false,
        message: "签到功能未启用",
      })),
    acquireLease: () => {
      leaseCalls += 1;
      return Promise.resolve({ acquired: false, waitedMs: 0 });
    },
    browserCheckin: () => {
      browserCalls += 1;
      throw new Error("browser must not run");
    },
  });
  assertEquals(result.checkinStatus, "unknown", "check-in status");
  assertEquals(result.taskStatus, "skipped", "task status");
  assertEquals(result.skipped, true, "skipped flag");
  assertEquals(result.checkinMethod, "direct", "check-in method");
  assertEquals(leaseCalls, 0, "lease call count");
  assertEquals(browserCalls, 0, "browser call count");
});

Deno.test("account check-in leaves disabled and busy challenges skipped", async () => {
  const challenge = () =>
    Promise.resolve(response({
      success: false,
      message: "需要 Turnstile 人机验证",
    }));
  const disabled = await runCheckin(account, {
    loadSettings: () => settings(false),
    directCheckin: challenge,
  });
  assertEquals(
    {
      status: disabled.checkinStatus,
      task: disabled.taskStatus,
      method: disabled.checkinMethod,
      automation: disabled.automation,
    },
    {
      status: "manual_required",
      task: "skipped",
      method: "direct",
      automation: { attempted: false, code: "disabled", durationMs: 0 },
    },
    "disabled outcome",
  );

  const busy = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: challenge,
    acquireLease: () => Promise.resolve({ acquired: false, waitedMs: 10_000 }),
    now: () => 1_000,
  });
  assertEquals(busy.checkinStatus, "manual_required", "busy status");
  assertEquals(busy.taskStatus, "skipped", "busy task status");
  assertEquals(busy.automation, {
    attempted: false,
    code: "busy",
    durationMs: 10_000,
  }, "busy automation");
});

Deno.test("account check-in counts lease wait inside the browser timeout", async () => {
  let now = 10_000;
  let browserTimeout = 0;
  let released = false;
  let leaseOptions: unknown = null;
  const result = await runCheckin(account, {
    loadSettings: () => settings(true, "120"),
    directCheckin: () =>
      Promise.resolve(response({
        success: false,
        message: "captcha required",
      })),
    acquireLease: (options) => {
      leaseOptions = options;
      now += 5_000;
      return Promise.resolve(fakeLease(() => released = true));
    },
    browserCheckin: (input) => {
      browserTimeout = input.timeoutMs;
      now += 1_500;
      return Promise.resolve({
        ok: true,
        code: "checked",
        message: "浏览器签到成功",
        durationMs: 1_500,
      });
    },
    now: () => now,
  });
  assertEquals(leaseOptions, {
    maxWaitMs: 10_000,
    ttlMs: 150_000,
    heartbeatMs: 20_000,
  }, "lease options");
  assertEquals(browserTimeout, 115_000, "remaining browser timeout");
  assertEquals(result.checkinStatus, "checked", "check-in status");
  assertEquals(result.checkinMethod, "browser", "check-in method");
  assertEquals(result.taskStatus, "success", "task status");
  assertEquals(result.automation, {
    attempted: true,
    code: "checked",
    durationMs: 6_500,
  }, "automation metadata");
  assert(released, "lease should be released");
});

Deno.test("started browser failure remains manual-required but fails the task", async () => {
  const result = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: () =>
      Promise.resolve(response({
        success: false,
        message: "captcha required",
      })),
    acquireLease: () => Promise.resolve(fakeLease()),
    browserCheckin: () =>
      Promise.resolve({
        ok: false,
        code: "challenge_timeout",
        message: "verification timed out",
        durationMs: 120_000,
      }),
    now: () => 2_000,
  });
  assertEquals(result.checkinStatus, "manual_required", "check-in status");
  assertEquals(result.checkinMethod, "browser", "check-in method");
  assertEquals(result.taskStatus, "failed", "task status");
  assertEquals(result.automation?.attempted, true, "attempted flag");
  assertEquals(result.automation?.code, "challenge_timeout", "failure code");
});

Deno.test("browser lease infrastructure failure remains manually recoverable", async () => {
  const result = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: () =>
      Promise.resolve(response({
        success: false,
        message: "captcha required",
      })),
    acquireLease: () => Promise.reject(new Error("database unavailable")),
    now: () => 1_000,
  });
  assertEquals(result.checkinStatus, "manual_required", "check-in status");
  assertEquals(result.taskStatus, "failed", "task status");
  assertEquals(result.automation, {
    attempted: false,
    code: "internal_error",
    durationMs: 0,
  }, "automation metadata");
  assert(
    !result.message.includes("database unavailable"),
    "lease error leaked into the user-visible log",
  );
});

Deno.test("uncertain browser cleanup quarantines the global lease", async () => {
  let released = false;
  let abandoned = false;
  const result = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: () =>
      Promise.resolve(response({
        success: false,
        message: "captcha required",
      })),
    acquireLease: () =>
      Promise.resolve(fakeLease(() => released = true, () => abandoned = true)),
    browserCheckin: () =>
      Promise.resolve({
        ok: false,
        code: "cleanup_failed",
        message: "cleanup uncertain",
        durationMs: 120_000,
      }),
  });
  assertEquals(result.checkinStatus, "manual_required", "check-in status");
  assert(!released, "uncertain cleanup released the lease early");
  assert(abandoned, "uncertain cleanup did not quarantine the lease");
});

Deno.test("direct transport errors retain the legacy error field", async () => {
  const result = await runCheckin(account, {
    loadSettings: () => settings(true),
    directCheckin: () => Promise.reject(new Error("direct timeout")),
  });
  assertEquals(result.checkinStatus, "failed", "check-in status");
  assertEquals(result.error, "direct timeout", "legacy error");
  assertEquals(result.checkinMethod, "direct", "check-in method");
});
