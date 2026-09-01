import {
  isAllowedBrowserWebSocket,
  redactBrowserCheckinText,
} from "./browser_checkin_service.ts";

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

Deno.test("browser check-in applies the origin allowlist to WebSockets", () => {
  const allowed = new Set([
    "https://upstream.example",
    "http://plain.example:8080",
    "https://challenges.cloudflare.com",
  ]);
  assert(
    isAllowedBrowserWebSocket("wss://upstream.example/socket", allowed),
    "same-origin WSS was blocked",
  );
  assert(
    isAllowedBrowserWebSocket("ws://plain.example:8080/socket", allowed),
    "same-origin WS was blocked",
  );
  assert(
    !isAllowedBrowserWebSocket("wss://collector.example/leak", allowed),
    "external WSS bypassed the allowlist",
  );
  assert(
    !isAllowedBrowserWebSocket("ws://127.0.0.1/admin", allowed),
    "private WebSocket bypassed the network guard",
  );
});
