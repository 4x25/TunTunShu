import {
  normalizeBrowserCheckinEnabled,
  normalizeBrowserCheckinTimeout,
} from "./settings_service.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("browser check-in enabled setting only accepts exact true", () => {
  assertEquals(normalizeBrowserCheckinEnabled("true"), "true");
  assertEquals(normalizeBrowserCheckinEnabled("TRUE"), "false");
  assertEquals(normalizeBrowserCheckinEnabled(" true "), "false");
  assertEquals(normalizeBrowserCheckinEnabled(undefined), "false");
});

Deno.test("browser check-in timeout setting is clamped and normalized", () => {
  assertEquals(normalizeBrowserCheckinTimeout(undefined), "120");
  assertEquals(normalizeBrowserCheckinTimeout(""), "120");
  assertEquals(normalizeBrowserCheckinTimeout("abc"), "120");
  assertEquals(normalizeBrowserCheckinTimeout("10"), "30");
  assertEquals(normalizeBrowserCheckinTimeout("75.9"), "75");
  assertEquals(normalizeBrowserCheckinTimeout("999"), "120");
});
