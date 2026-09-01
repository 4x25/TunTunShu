import { getAuthKey } from "../lib/env.ts";
import { defaultSettings } from "../lib/config.ts";
import { getSql } from "../db/client.ts";

export async function getSettings() {
  const sql = getSql();
  const rows = await sql<
    { key: string; value: string }[]
  >`select key, value from system_settings`;
  const settings: Record<string, string> = { ...defaultSettings };
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  settings.proxy_auth_keys = normalizeProxyKeys(settings.proxy_auth_keys);
  settings.browser_checkin_enabled = normalizeBrowserCheckinEnabled(
    settings.browser_checkin_enabled,
  );
  settings.browser_checkin_timeout_seconds = normalizeBrowserCheckinTimeout(
    settings.browser_checkin_timeout_seconds,
  );
  return settings;
}

export async function updateSettings(input: Record<string, string>) {
  const sql = getSql();
  const allowedKeys = new Set(Object.keys(defaultSettings));
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key)) continue;
    const normalizedValue = key === "proxy_auth_keys"
      ? normalizeProxyKeys(value)
      : key === "browser_checkin_enabled"
      ? normalizeBrowserCheckinEnabled(value)
      : key === "browser_checkin_timeout_seconds"
      ? normalizeBrowserCheckinTimeout(value)
      : value;
    await sql`
      insert into system_settings (key, value, updated_at)
      values (${key}, ${normalizedValue}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
  }
  return await getSettings();
}

function normalizeProxyKeys(value: string) {
  const keys = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set([getAuthKey(), ...keys])).join("\n");
}

export function normalizeBrowserCheckinEnabled(value: string | undefined) {
  return value === "true" ? "true" : "false";
}

export function normalizeBrowserCheckinTimeout(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return defaultSettings.browser_checkin_timeout_seconds;
  }
  return String(Math.min(120, Math.max(30, parsed)));
}
