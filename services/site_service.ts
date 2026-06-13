import { NewApiAdapter } from "../adapters/new_api_adapter.ts";
import { getSql } from "../db/client.ts";
import { createSystemTaskLog } from "./system_task_log_service.ts";

const adapter = new NewApiAdapter();

export async function createSite(input: {
  name: string;
  origin: string;
  remark?: string | null;
}) {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    insert into sites (name, origin, remark)
    values (${input.name}, ${input.origin}, ${input.remark ?? null})
    returning id
  `;
  return rows[0]?.id ?? null;
}

export async function listSites() {
  const sql = getSql();
  return await sql`select * from sites order by id desc`;
}

export async function healthCheckSite(id: number) {
  const sql = getSql();
  const rows = await sql<{ id: number; origin: string }[]>`
    select id, origin from sites where id = ${id}
  `;
  const site = rows[0];
  if (!site) return null;
  try {
    const response = await adapter.healthCheck(site.origin);
    const healthy = response.status !== 404 && response.status < 500;
    const status = healthy ? "healthy" : "down";
    const logId = await createSystemTaskLog({
      taskType: "site_health_check",
      status: healthy ? "success" : "failed",
      siteId: id,
      message: `http_status=${response.status}`,
    });
    await sql`
      update sites
      set status = ${status}, last_health_check_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return { ok: healthy, httpStatus: response.status, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logId = await createSystemTaskLog({
      taskType: "site_health_check",
      status: "failed",
      siteId: id,
      message,
    });
    await sql`
      update sites
      set status = 'down', last_health_check_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return { ok: false, error: message, status: "down" };
  }
}

export async function deleteSite(id: number) {
  const sql = getSql();
  const accounts = await sql<
    { id: number }[]
  >`select id from accounts where site_id = ${id}`;
  for (const account of accounts) {
    const apiKeys = await sql<
      { id: number }[]
    >`select id from api_keys where account_id = ${account.id}`;
    for (const apiKey of apiKeys) {
      await sql`delete from upstream_models where api_key_id = ${apiKey.id}`;
    }
    await sql`delete from api_keys where account_id = ${account.id}`;
  }
  await sql`delete from accounts where site_id = ${id}`;
  await sql`delete from sites where id = ${id}`;
}
