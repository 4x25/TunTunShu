import { repairJsonCache } from "./init.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

const payload = {
  checkin_enabled: false,
  turnstile_check: false,
  system_name: "6655 翻译小站",
  version: "a0.5.1.8",
};

Deno.test("repairJsonCache restores a doubly-encoded jsonb string", () => {
  assertEquals(
    repairJsonCache(JSON.stringify(payload)),
    payload,
    "jsonb string (the driver double-encoded it)",
  );
});

Deno.test("repairJsonCache merges an array produced by the || merge", () => {
  // `'"<json>"'::jsonb || '{"checkin_enabled": false}'::jsonb` 会得到这个形状。
  assertEquals(
    repairJsonCache([JSON.stringify(payload), { checkin_enabled: false }]),
    payload,
    "array from jsonb concatenation",
  );
  assertEquals(
    repairJsonCache([JSON.stringify({ a: 1 }), { b: 2 }]),
    { a: 1, b: 2 },
    "later object elements win",
  );
});

Deno.test("repairJsonCache passes through an already correct object", () => {
  assertEquals(repairJsonCache(payload), payload, "plain jsonb object");
});

Deno.test("repairJsonCache returns undefined when nothing is recoverable", () => {
  assert(
    repairJsonCache("not json at all") === undefined,
    "unparseable string stays untouched",
  );
  assert(repairJsonCache(42) === undefined, "non-object scalar");
  assert(repairJsonCache(null) === undefined, "null");
  assert(repairJsonCache([]) === undefined, "empty array");
  assert(
    repairJsonCache(["garbage", "also garbage"]) === undefined,
    "array without a parseable object",
  );
  assertEquals(
    repairJsonCache([JSON.stringify({ a: 1 }), "garbage"]),
    { a: 1 },
    "the parseable element is still recovered",
  );
});
