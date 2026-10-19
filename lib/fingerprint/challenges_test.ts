import { generateChallenges } from "./challenges.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("generateChallenges 生成本轮唯一的 292–332 数量", () => {
  const challenges = generateChallenges(3);
  assert(challenges.length === 3, "expected 3 challenges");
  const lengths = challenges.map((challenge) => challenge.expected_count);
  assert(new Set(lengths).size === 3, "lengths must be unique");
  for (const challenge of challenges) {
    assert(
      challenge.expected_count >= 292 && challenge.expected_count <= 332,
      `unexpected count ${challenge.expected_count}`,
    );
    assert(
      challenge.prompt.includes(String(challenge.expected_count)),
      "prompt must contain the expected count",
    );
    assert(challenge.id.startsWith("probe-"), "id prefix");
  }
});

Deno.test("generateChallenges 可用长度不足时抛错", () => {
  const all = Array.from({ length: 41 }, (_, i) => 292 + i);
  let threw = false;
  try {
    generateChallenges(3, all);
  } catch {
    threw = true;
  }
  assert(threw, "expected insufficient-length error");
});

Deno.test("generateChallenges 换题时避开已用数量", () => {
  const challenges = generateChallenges(3, [292, 293]);
  const lengths = challenges.map((challenge) => challenge.expected_count);
  assert(!lengths.includes(292), "must not reuse 292");
  assert(!lengths.includes(293), "must not reuse 293");
  assert(new Set(lengths).size === 3, "lengths must be unique");
});
