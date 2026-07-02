import { getSql } from "../db/client.ts";
import { NewApiAdapter } from "../adapters/new_api_adapter.ts";
import { type PageParams, pageResult } from "../lib/pagination.ts";
import { createSystemTaskLog } from "./system_task_log_service.ts";

const adapter = new NewApiAdapter();

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

export async function listApiKeys(params: PageParams) {
  const sql = getSql();
  const values: Array<number | string> = [];
  const where: string[] = [];
  if (params.siteId !== undefined) {
    values.push(params.siteId);
    where.push(`accounts.site_id = $${values.length}`);
  }
  if (params.accountId !== undefined) {
    values.push(params.accountId);
    where.push(`api_keys.account_id = $${values.length}`);
  }
  if (params.q) {
    values.push(`%${params.q}%`);
    where.push(
      `(api_keys.name ilike $${values.length} or api_keys.key ilike $${values.length})`,
    );
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const fromSql = `
    from api_keys
    join accounts on accounts.id = api_keys.account_id
  `;
  const countRows = await sql.unsafe<{ count: number }[]>(
    `select count(*)::int as count ${fromSql} ${whereSql}`,
    values,
  );
  const pageValues = [...values, params.pageSize, params.offset];
  const items = await sql.unsafe(
    `select api_keys.* ${fromSql} ${whereSql}
     order by api_keys.id desc
     limit $${values.length + 1} offset $${values.length + 2}`,
    pageValues,
  );
  return pageResult(items, params, Number(countRows[0]?.count ?? 0));
}

export async function updateApiKey(
  id: number,
  input: { name?: string; key?: string; enabled?: boolean },
) {
  const sql = getSql();
  const current = await sql<
    { name: string; key: string; enabled: boolean }[]
  >`select name, key, enabled from api_keys where id = ${id}`;
  if (!current[0]) return null;
  const name = input.name ?? current[0].name;
  const key = input.key ?? current[0].key;
  const enabled = input.enabled ?? current[0].enabled;
  await sql`
    update api_keys
    set name = ${name}, key = ${key}, enabled = ${enabled}, updated_at = now()
    where id = ${id}
  `;
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
