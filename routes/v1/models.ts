import { define } from "../../utils.ts";
import { getSql } from "../../db/client.ts";
import { defaultSettings } from "../../lib/config.ts";
import { getAuthKey } from "../../lib/env.ts";
import { json, openaiError } from "../../lib/response.ts";

function splitKeys(value: string | null): string[] {
  return (value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(
    Boolean,
  );
}

function extractBearer(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice(7).trim() || null;
}

async function getProxyKeys(): Promise<string[]> {
  const sql = getSql();
  const rows = await sql<{ value: string }[]>`
    select value from system_settings where key = 'proxy_auth_keys' limit 1
  `;
  const saved = rows[0]?.value ?? defaultSettings.proxy_auth_keys;
  return Array.from(new Set([getAuthKey(), ...splitKeys(saved)]));
}

export const handler = define.handlers({
  async GET(ctx) {
    const token = extractBearer(ctx.req);
    if (!token || !(await getProxyKeys()).includes(token)) {
      return openaiError("Invalid authentication credentials", {
        status: 401,
        code: "invalid_api_key",
      });
    }
    const sql = getSql();
    const rows = await sql<{ name: string }[]>`
      select models.name from models
      join upstream_models on upstream_models.model_id = models.id
      join api_keys on api_keys.id = upstream_models.api_key_id
      join accounts on accounts.id = api_keys.account_id
      join sites on sites.id = accounts.site_id
      where models.enabled = true
        and upstream_models.enabled = true
        and upstream_models.status <> 'invalid'
        and api_keys.enabled = true
        and api_keys.status <> 'invalid'
        and accounts.enabled = true
        and accounts.status <> 'invalid'
        and sites.enabled = true
        and sites.status <> 'down'
      group by models.id, models.name
      order by models.id desc
    `;
    return json({
      object: "list",
      data: rows.map((row) => ({
        id: row.name,
        object: "model",
        created: 0,
        owned_by: "tuntunshu",
      })),
    });
  },
});
