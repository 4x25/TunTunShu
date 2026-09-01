import {
  assertSafeBrowserOrigin,
  isPrivateNetworkAddress,
} from "./browser_checkin_security.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  }
}

Deno.test("browser check-in accepts only pure public HTTP(S) origins", () => {
  assertEquals(
    assertSafeBrowserOrigin("https://example.com:8443"),
    "https://example.com:8443",
    "public origin",
  );
  for (
    const value of [
      "ftp://example.com",
      "https://user:pass@example.com",
      "https://example.com/path",
      "https://example.com/?query=1",
      "https://example.com/#hash",
      "http://localhost",
      "http://127.0.0.1",
      "http://[::1]",
      "http://169.254.169.254",
      "not a URL",
    ]
  ) {
    let threw = false;
    try {
      assertSafeBrowserOrigin(value);
    } catch {
      threw = true;
    }
    assert(threw, `unsafe origin was accepted: ${value}`);
  }
});

Deno.test("browser check-in blocks private and reserved IPv4/IPv6 forms", () => {
  for (
    const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "2001:db8::1",
    ]
  ) {
    assert(
      isPrivateNetworkAddress(address),
      `private address accepted: ${address}`,
    );
  }
  assert(!isPrivateNetworkAddress("8.8.8.8"), "public IPv4 was blocked");
  assert(
    !isPrivateNetworkAddress("2606:4700:4700::1111"),
    "public IPv6 was blocked",
  );
});
