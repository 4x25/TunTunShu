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
  return settings;
}

export async function updateSettings(input: Record<string, string>) {
  const sql = getSql();
  const allowedKeys = new Set(Object.keys(defaultSettings));
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key)) continue;
    const normalizedValue = key === "proxy_auth_keys"
      ? normalizeProxyKeys(value)
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
