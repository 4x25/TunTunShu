import {
  browserCheckinEnabled,
  browserCheckinTimeoutMs,
  classifyDirectCheckin,
} from "./checkin_classifier.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

function classify(
  body: string,
  status = 200,
  headers: HeadersInit = {},
) {
  return classifyDirectCheckin({ body, status, headers: new Headers(headers) });
}

Deno.test("direct check-in classifier accepts success and quota", () => {
  assertEquals(
    classify(JSON.stringify({
      success: true,
      message: "ok",
      data: { quota_awarded: 500 },
    })),
    { kind: "checked", message: "签到成功 +500", quotaAwarded: 500 },
    "success outcome",
  );
});

Deno.test("direct check-in classifier treats already checked as success", () => {
  assertEquals(
    classify(JSON.stringify({ success: false, message: "今天已经签到了" })),
    { kind: "checked", message: "今天已经签到了", quotaAwarded: null },
    "already checked outcome",
  );
});

Deno.test("direct check-in classifier recognizes explicit captcha messages", () => {
  assertEquals(
    classify(JSON.stringify({
      success: false,
      message: "Turnstile 人机验证失败",
    })).kind,
    "challenge",
    "captcha outcome",
  );
});

Deno.test("direct check-in classifier recognizes trusted Cloudflare HTML", () => {
  assertEquals(
    classify(
      "<title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/x'></script>",
      503,
      { server: "cloudflare", "cf-ray": "abc" },
    ).kind,
    "challenge",
    "Cloudflare outcome",
  );
  assertEquals(
    classify("", 403, { "cf-mitigated": "challenge" }).kind,
    "challenge",
    "cf-mitigated outcome",
  );
});

Deno.test("direct check-in classifier rejects untrusted HTML and ordinary errors", () => {
  assertEquals(
    classify("<title>Just a moment...</title>", 503).kind,
    "failed",
    "unattributed HTML",
  );
  assertEquals(
    classify("gateway down", 503, { server: "cloudflare" }).kind,
    "failed",
    "ordinary Cloudflare error",
  );
  assertEquals(
    classify(JSON.stringify({ success: false, message: "签到功能未启用" }))
      .kind,
    "failed",
    "business failure",
  );
});

Deno.test("browser check-in settings are normalized safely", () => {
  assertEquals(browserCheckinEnabled("true"), true, "enabled setting");
  assertEquals(
    browserCheckinEnabled(" TRUE "),
    false,
    "strict enabled setting",
  );
  assertEquals(browserCheckinEnabled("1"), false, "non-boolean setting");
  assertEquals(browserCheckinTimeoutMs(undefined), 120_000, "default timeout");
  assertEquals(browserCheckinTimeoutMs("10"), 30_000, "minimum timeout");
  assertEquals(browserCheckinTimeoutMs("75.9"), 75_000, "integer timeout");
  assertEquals(browserCheckinTimeoutMs("999"), 120_000, "maximum timeout");
});
