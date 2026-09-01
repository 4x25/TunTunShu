import { redactBrowserCheckinText } from "./browser_checkin_service.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("browser check-in redactor removes credentials and challenge tokens", () => {
  const pat = "pat-canary-secret";
  const output = redactBrowserCheckinText(
    `failed ${pat} Bearer auth-secret ` +
      `https://user:pass@example.com/profile?accessToken=${pat}` +
      `&turnstile=turnstile-canary&captcha=captcha-canary`,
    [pat],
  );
  for (
    const secret of [
      pat,
      "auth-secret",
      "user:pass",
      "turnstile-canary",
      "captcha-canary",
    ]
  ) {
    assert(!output.includes(secret), `redactor leaked ${secret}`);
  }
  assert(output.includes("[redacted]"), "redactor produced no marker");
});
