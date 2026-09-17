import {
  buildAccountLoginHref,
  buildUpstreamLoginUrl,
  isUpstreamLoginScriptInstalled,
  parsePureHttpOrigin,
  UPSTREAM_LOGIN_SCRIPT_MARKER,
} from "./upstream_login.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: ${actual} !== ${expected}`);
  }
}

Deno.test("upstream login URL 只接受纯 HTTP(S) origin 并正确编码凭据", () => {
  assertEquals(
    parsePureHttpOrigin("http://example.com:8080"),
    "http://example.com:8080",
    "HTTP origin mismatch",
  );
  const url = buildUpstreamLoginUrl(
    "https://example.com",
    "token+/= value",
    "42",
  );
  const parsed = new URL(url);
  assertEquals(parsed.origin, "https://example.com", "origin mismatch");
  assert(
    parsed.hash.startsWith("#__tts_upstream_login__?"),
    "fragment marker missing",
  );
  const params = new URLSearchParams(parsed.hash.split("?")[1]);
  assertEquals(params.get("accessToken"), "token+/= value", "PAT mismatch");
  assertEquals(params.get("userId"), "42", "userId mismatch");
  assert(!params.has("expectedOrigin"), "unexpected expectedOrigin parameter");

  for (
    const invalid of [
      "ftp://example.com",
      "https://user@example.com",
      "https://example.com/path",
      "https://example.com/?q=1",
      "https://example.com/#hash",
      "not a URL",
    ]
  ) {
    let threw = false;
    try {
      parsePureHttpOrigin(invalid);
    } catch {
      threw = true;
    }
    assert(threw, `invalid origin was accepted: ${invalid}`);
  }
});

Deno.test("upstream login marker 必须精确匹配脚本版本", () => {
  const scope = {} as typeof globalThis;
  assert(!isUpstreamLoginScriptInstalled(scope), "missing marker accepted");
  Reflect.set(scope, UPSTREAM_LOGIN_SCRIPT_MARKER, "0.9.0");
  assert(!isUpstreamLoginScriptInstalled(scope), "stale marker accepted");
  Reflect.set(scope, UPSTREAM_LOGIN_SCRIPT_MARKER, "2.0.0");
  assert(isUpstreamLoginScriptInstalled(scope), "current marker rejected");
});

Deno.test("账号登录链接仅在脚本就绪且 Origin 合法时携带 PAT", () => {
  assertEquals(
    buildAccountLoginHref(false, "https://example.com", "pat-token", "42"),
    null,
    "script missing must not expose PAT",
  );
  assertEquals(
    buildAccountLoginHref(true, null, "pat-token", "42"),
    null,
    "missing origin must not build link",
  );
  assertEquals(
    buildAccountLoginHref(true, undefined, "pat-token", "42"),
    null,
    "undefined origin must not build link",
  );
  assertEquals(
    buildAccountLoginHref(true, "https://example.com/path", "pat-token", "42"),
    null,
    "invalid origin must not build link",
  );
  assertEquals(
    buildAccountLoginHref(true, "not a url", "pat-token", "42"),
    null,
    "non-URL origin must not build link",
  );
  const href = buildAccountLoginHref(
    true,
    "https://example.com",
    "pat-token",
    "42",
  );
  assert(href !== null, "valid input must build link");
  assert(
    href.startsWith("https://example.com/#__tts_upstream_login__?"),
    "link must target upstream fragment",
  );
  assert(href.includes("accessToken=pat-token"), "link must carry PAT");
  assert(href.includes("userId=42"), "link must carry userId");
});
