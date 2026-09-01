export type DirectCheckinKind = "checked" | "challenge" | "failed";

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
const CLOUDFLARE_CHALLENGE_STATUS = new Set([403, 429, 503]);
const CLOUDFLARE_BODY_MARKER =
  /cf-chl-|challenge-platform|just a moment|attention required|cloudflare ray id|checking (?:your )?browser|enable javascript and cookies/i;

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
 * message or a response with trusted Cloudflare challenge signals. Arbitrary
 * HTML and ordinary 4xx/5xx responses remain failures.
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
