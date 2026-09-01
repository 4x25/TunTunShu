import { classifyAccountCheckinResult } from "./account_checkin_job.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: ${actual} !== ${expected}`);
  }
}

Deno.test("account check-in job distinguishes skipped and attempted automation", () => {
  assertEquals(
    classifyAccountCheckinResult({ ok: true, checkinStatus: "checked" }),
    "success",
    "checked result",
  );
  assertEquals(
    classifyAccountCheckinResult({
      ok: false,
      checkinStatus: "manual_required",
      automation: { attempted: false },
    }),
    "skipped",
    "browser busy/disabled result",
  );
  assertEquals(
    classifyAccountCheckinResult({
      ok: false,
      checkinStatus: "manual_required",
      automation: { attempted: true },
    }),
    "failed",
    "started browser failure",
  );
  assertEquals(
    classifyAccountCheckinResult({
      ok: false,
      checkinStatus: "manual_required",
      automation: { attempted: false, code: "internal_error" },
    }),
    "failed",
    "browser infrastructure failure",
  );
  assertEquals(classifyAccountCheckinResult(null), "failed", "missing account");
});
