import { getSql } from "../db/client.ts";
import { NewApiAdapter } from "../adapters/new_api_adapter.ts";
import { createSystemTaskLog } from "./system_task_log_service.ts";
import {
  findUpstreamTokenIdByKey,
  setUpstreamTokenEnabled,
} from "./new_api_token_service.ts";

const adapter = new NewApiAdapter();

export class UpstreamApiKeySyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamApiKeySyncError";
  }
}

interface ApiKeyUpdateRow {
  name: string;
  key: string;
  enabled: boolean;
  user_id: string;
  access_token: string;
  origin: string;
}

async function syncApiKeyEnabledToUpstream(
  row: ApiKeyUpdateRow,
  enabled: boolean,
) {
  const auth = {
    origin: row.origin,
    userId: row.user_id,
    accessToken: row.access_token,
  };
  const found = await findUpstreamTokenIdByKey(auth, row.key);
  if (!found.ok || !found.tokenId) {
    const error = typeof found.data === "object" && found.data &&
        "error" in found.data
      ? String(found.data.error)
      : "";
    const message = error === "ambiguous_masked_key"
      ? "上游存在多个遮罩后相同的 APIKey，无法安全启停"
      : error === "token_lookup_incomplete"
      ? "上游 APIKey 读取不完整，无法安全启停"
      : "上游未找到对应 APIKey";
    throw new UpstreamApiKeySyncError(message);
  }

  const updated = await setUpstreamTokenEnabled(auth, found.tokenId, enabled);
  if (!updated.ok) {
    const message = updated.data.message || "上游拒绝更新 APIKey 状态";
    throw new UpstreamApiKeySyncError(message);
  }
}

export async function createApiKey(
  input: { accountId: number; name: string; key: string },
) {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    insert into api_keys (account_id, name, key)
    values (${input.accountId}, ${input.name}, ${input.key})
    returning id
  `;
  return rows[0]?.id ?? null;
}

export async function listApiKeys() {
  const sql = getSql();
  return await sql`select * from api_keys order by id desc`;
}

export async function updateApiKey(
  id: number,
  input: { name?: string; key?: string; enabled?: boolean },
) {
  const sql = getSql();
  const current = await sql<ApiKeyUpdateRow[]>`
    select api_keys.name, api_keys.key, api_keys.enabled,
           accounts.user_id, accounts.access_token, sites.origin
    from api_keys
    join accounts on accounts.id = api_keys.account_id
    join sites on sites.id = accounts.site_id
    where api_keys.id = ${id}
  `;
  if (!current[0]) return null;
  const name = input.name ?? current[0].name;
  const key = input.key ?? current[0].key;
  const enabled = input.enabled ?? current[0].enabled;
  const enabledChanged = input.enabled !== undefined &&
    enabled !== current[0].enabled;
  await sql`
    update api_keys
    set name = ${name}, key = ${key}, enabled = ${enabled}, updated_at = now()
    where id = ${id}
  `;
  if (enabledChanged) {
    try {
      await syncApiKeyEnabledToUpstream(current[0], enabled);
    } catch (error) {
      await sql`
        update api_keys
        set name = ${current[0].name},
            key = ${current[0].key},
            enabled = ${current[0].enabled},
            updated_at = now()
        where id = ${id}
      `;
      throw error;
    }
  }
  return { id, name, enabled };
}

export async function deleteApiKey(id: number) {
  const sql = getSql();
  await sql`delete from upstream_models where api_key_id = ${id}`;
  await sql`delete from api_keys where id = ${id}`;
}

export async function syncApiKeyModels(id: number) {
  const sql = getSql();
  const rows = await sql<
    {
      id: number;
      key: string;
      account_id: number;
      site_id: number;
      origin: string;
    }[]
  >`
    select api_keys.id, api_keys.key, api_keys.account_id, accounts.site_id, sites.origin
    from api_keys
    join accounts on accounts.id = api_keys.account_id
    join sites on sites.id = accounts.site_id
    where api_keys.id = ${id}
  `;
  const apiKey = rows[0];
  if (!apiKey) return null;
  try {
    const response = await adapter.getModels({
      origin: apiKey.origin,
      apiKey: apiKey.key,
    });
    const data = await response.json().catch(() => ({})) as {
      data?: Array<{ id?: string }>;
    };
    const names = (Array.isArray(data.data) ? data.data : []).map((item) =>
      item.id
    ).filter((name): name is string => Boolean(name));
    const logId = await createSystemTaskLog({
      taskType: "api_key_model_sync",
      status: response.ok ? "success" : "failed",
      siteId: apiKey.site_id,
      accountId: apiKey.account_id,
      apiKeyId: apiKey.id,
      message: `models=${names.length}`,
    });
    if (!response.ok) {
      await sql`update api_keys set status = 'invalid', updated_at = now() where id = ${id}`;
      return { ok: false, status: response.status, data };
    }
    await sql`update api_keys set status = 'healthy', updated_at = now() where id = ${id}`;
    await sql`update upstream_models set status = 'invalid', last_sync_log_id = ${logId}, updated_at = now() where api_key_id = ${id}`;
    for (const name of names) {
      const existing = await sql<{ id: number }[]>`
        select id from upstream_models where api_key_id = ${id} and name = ${name} limit 1
      `;
      if (existing[0]) {
        await sql`
          update upstream_models
          set status = 'healthy', last_sync_log_id = ${logId}, updated_at = now()
          where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into upstream_models (api_key_id, name, status, last_sync_log_id)
          values (${id}, ${name}, 'healthy', ${logId})
        `;
      }
    }
    return { ok: true, count: names.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await createSystemTaskLog({
      taskType: "api_key_model_sync",
      status: "failed",
      siteId: apiKey.site_id,
      accountId: apiKey.account_id,
      apiKeyId: apiKey.id,
      message,
    });
    await sql`update api_keys set status = 'invalid', updated_at = now() where id = ${id}`;
    return { ok: false, error: message };
  }
}
