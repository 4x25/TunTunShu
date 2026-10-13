export type DirectCheckinKind =
  | "checked"
  | "challenge"
  | "disabled"
  | "failed";

export interface DirectCheckinOutcome {
  kind: DirectCheckinKind;
  message: string;
  quotaAwarded: number | null;
}

export interface DirectCheckinInput {
  status: number;
  headers: Headers;
  body: string;
}

export function browserCheckinEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function browserCheckinTimeoutMs(value: string | undefined): number {
  const seconds = Number.parseInt(value ?? "", 10);
  const normalized = Number.isFinite(seconds) ? seconds : 120;
  return Math.min(120, Math.max(30, normalized)) * 1000;
}

const CHECKED_MESSAGE = /已签到|已经签到|已签/;
const CHALLENGE_MESSAGE = /turnstile|captcha|验证码|人机验证/i;
// new-api 站点未启用签到时,GET/POST /api/user/checkin 都回 HTTP 200 +
// {success:false,...}(controller/checkin.go)。旧版回中文 message;i18n 改版
// (upstream 128089fa7,首个含它的 tag 为 v1.0.0-rc.43~8)后 message 直接回英文
// key「Check-in feature is not enabled」(success:false + message_key)。
const CHECKIN_DISABLED_MESSAGE = /签到功能未启用|签到未启用|签到功能已关闭/i;
const CHECKIN_DISABLED_ENGLISH_MESSAGE =
  /check-in feature is not enabled|check-in is not enabled/i;
// POST /api/user/checkin 404:上游根本没有注册该路由(旧版/未开放签到功能)。
const CHECKIN_ROUTE_NOT_FOUND_MESSAGE = "站点未开放签到功能（HTTP 404）";
const CLOUDFLARE_CHALLENGE_STATUS = new Set([403, 429, 503]);
const CLOUDFLARE_BODY_MARKER =
  /cf-chl-|challenge-platform|just a moment|attention required|cloudflare ray id|checking (?:your )?browser|enable javascript and cookies/i;

/** 上游业务回执是否明确表示「签到功能未启用」(兼容旧版中文与 i18n 改版后的英文 key)。 */
export function isCheckinDisabledMessage(message: unknown): boolean {
  return typeof message === "string" &&
    (CHECKIN_DISABLED_MESSAGE.test(message) ||
      CHECKIN_DISABLED_ENGLISH_MESSAGE.test(message));
}

function parseBusinessBody(body: string): {
  success: boolean;
  message: string;
  quotaAwarded: number | null;
} | null {
  try {
    const value = JSON.parse(body) as {
      success?: unknown;
      message?: unknown;
      data?: { quota_awarded?: unknown } | null;
    };
    if (typeof value?.success !== "boolean") return null;
    return {
      success: value.success,
      message: typeof value.message === "string" ? value.message : "",
      quotaAwarded: typeof value.data?.quota_awarded === "number"
        ? value.data.quota_awarded
        : null,
    };
  } catch {
    return null;
  }
}

function isTrustedCloudflareChallenge(input: DirectCheckinInput): boolean {
  if (input.headers.get("cf-mitigated")?.toLowerCase() === "challenge") {
    return true;
  }
  if (!CLOUDFLARE_CHALLENGE_STATUS.has(input.status)) return false;
  const attributedToCloudflare =
    input.headers.get("server")?.toLowerCase().includes("cloudflare") ===
      true ||
    input.headers.has("cf-ray");
  return attributedToCloudflare && CLOUDFLARE_BODY_MARKER.test(input.body);
}

/**
 * Classify one direct new-api check-in response without side effects.
 *
 * A browser fallback is deliberately limited to an explicit upstream captcha
 * message or a response with trusted Cloudflare challenge signals. An upstream
 * "check-in not enabled" business reply or a 404 on the check-in route is
 * reported as `disabled` so callers can record it instead of retrying.
 * Arbitrary HTML and ordinary 4xx/5xx responses remain failures.
 *
 * 优先级说明:404 判断刻意排在 challenge 判断之前——Cloudflare challenge 用
 * 403/429/503,不会用 404,「POST 签到路由 404」是更强的『站点没有该功能』信号。
 * 调整顺序时需保留这一意图。
 */
export function classifyDirectCheckin(
  input: DirectCheckinInput,
): DirectCheckinOutcome {
  const parsed = parseBusinessBody(input.body);
  if (parsed?.success) {
    return {
      kind: "checked",
      message: parsed.quotaAwarded != null
        ? `签到成功 +${parsed.quotaAwarded}`
        : (parsed.message || "签到成功"),
      quotaAwarded: parsed.quotaAwarded,
    };
  }
  if (parsed && CHECKED_MESSAGE.test(parsed.message)) {
    return {
      kind: "checked",
      message: parsed.message || "今日已签到",
      quotaAwarded: parsed.quotaAwarded,
    };
  }
  if (parsed && isCheckinDisabledMessage(parsed.message)) {
    return {
      kind: "disabled",
      message: parsed.message || "站点未开放签到功能",
      quotaAwarded: null,
    };
  }
  // 上游没有签到路由(HTTP 404):明确未开放,不重试、不进浏览器。
  if (input.status === 404) {
    return {
      kind: "disabled",
      message: CHECKIN_ROUTE_NOT_FOUND_MESSAGE,
      quotaAwarded: null,
    };
  }
  if (
    (parsed && CHALLENGE_MESSAGE.test(parsed.message)) ||
    isTrustedCloudflareChallenge(input)
  ) {
    return {
      kind: "challenge",
      message: parsed?.message || "Cloudflare challenge required",
      quotaAwarded: null,
    };
  }
  return {
    kind: "failed",
    message: parsed?.message || input.body.slice(0, 1000) ||
      `http ${input.status}`,
    quotaAwarded: parsed?.quotaAwarded ?? null,
  };
}
