import { runBrowserCheckin } from "../services/browser_checkin_service.ts";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (Deno.env.get("TTS_CLOAK_LIVE") !== "1") {
  throw new Error(
    "Refusing to mutate a live account: set TTS_CLOAK_LIVE=1 explicitly",
  );
}

const timeout = Number(Deno.env.get("TTS_CLOAK_LIVE_TIMEOUT_SECONDS") ?? 120);
const result = await runBrowserCheckin({
  origin: required("TTS_CLOAK_LIVE_ORIGIN"),
  userId: required("TTS_CLOAK_LIVE_USER_ID"),
  accessToken: required("TTS_CLOAK_LIVE_ACCESS_TOKEN"),
  timeoutMs:
    Math.min(120, Math.max(30, Number.isFinite(timeout) ? timeout : 120)) *
    1000,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) Deno.exitCode = 1;
