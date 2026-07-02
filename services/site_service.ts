import { NewApiAdapter } from "../adapters/new_api_adapter.ts";
import { getSql } from "../db/client.ts";
import { type PageParams, pageResult } from "../lib/pagination.ts";
import { createSystemTaskLog } from "./system_task_log_service.ts";

const adapter = new NewApiAdapter();

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/** 请求 origin 的 /api/status,取 new-api 站点名称(data.system_name);失败返回 null。 */
export async function fetchSystemName(origin: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin.replace(/\/+$/, "")}/api/status`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TunTunShu/1.0)" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as
      | { data?: { system_name?: unknown } }
      | null;
    const name = body?.data?.system_name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** upsert 结果:updated=true 表示命中唯一键、就地更新了已有行。 */
export type CreateSiteResult = { id: number; updated: boolean };

/** porsager/postgres 在唯一约束冲突时抛出 code=23505 的错误。 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "23505";
}

export async function createSite(input: {
  name?: string | null;
  origin: string;
  remark?: string | null;
}): Promise<CreateSiteResult> {
  const sql = getSql();
  const origin = input.origin.replace(/\/+$/, "");

  // 命中已有 origin 时就地更新(只覆盖传入的非空字段,空串/缺省保持原值),否则插入新行。
  const mergeUpdate = async (id: number): Promise<CreateSiteResult> => {
    await updateSite(id, {
      name: input.name?.trim() || undefined,
      remark: input.remark?.trim() || undefined,
    });
    return { id, updated: true };
  };

  // 业务层查重:命中已有 origin 走更新分支,避免撞唯一索引报 500。
  const existing = await sql<{ id: number }[]>`
    select id from sites where origin = ${origin} limit 1
  `;
  if (existing[0]) return await mergeUpdate(existing[0].id);

  // 站点名称非必填:留空时请求 origin/api/status 取 system_name,再退回域名。
  let name = (input.name ?? "").trim();
  if (!name) {
    name = (await fetchSystemName(origin)) ?? hostOf(origin);
  }

  try {
    const rows = await sql<{ id: number }[]>`
      insert into sites (name, origin, remark)
      values (${name}, ${origin}, ${input.remark ?? null})
      returning id
    `;
    const inserted = rows[0];
    if (!inserted) throw new Error("createSite: insert 未返回新行");
    return { id: inserted.id, updated: false };
  } catch (error) {
    // 并发兜底:两请求同时通过查重,只有一个 insert 成功,另一个撞唯一索引(23505)→ 改走更新。
    if (isUniqueViolation(error)) {
      const dup = await sql<{ id: number }[]>`
        select id from sites where origin = ${origin} limit 1
      `;
      if (dup[0]) return await mergeUpdate(dup[0].id);
    }
    throw error;
  }
}

export async function listSites(params: PageParams) {
  const sql = getSql();
  const values: Array<number | string> = [];
  const where: string[] = [];
  if (params.q) {
    values.push(`%${params.q}%`);
    where.push(
      `(name ilike $${values.length} or origin ilike $${values.length})`,
    );
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const countRows = await sql.unsafe<{ count: number }[]>(
    `select count(*)::int as count from sites ${whereSql}`,
    values,
  );
  const pageValues = [...values, params.pageSize, params.offset];
  const items = await sql.unsafe(
    `select * from sites ${whereSql} order by id desc limit $${
      values.length + 1
    } offset $${values.length + 2}`,
    pageValues,
  );
  return pageResult(items, params, Number(countRows[0]?.count ?? 0));
}

export async function updateSite(
  id: number,
  input: {
    name?: string;
    origin?: string;
    enabled?: boolean;
    remark?: string | null;
  },
) {
  const sql = getSql();
  const current = await sql<
    { name: string; origin: string; enabled: boolean; remark: string | null }[]
  >`select name, origin, enabled, remark from sites where id = ${id}`;
  if (!current[0]) return null;
  const name = input.name ?? current[0].name;
  const origin = input.origin ?? current[0].origin;
  const enabled = input.enabled ?? current[0].enabled;
  const remark = input.remark !== undefined ? input.remark : current[0].remark;
  await sql`
    update sites
    set name = ${name}, origin = ${origin}, enabled = ${enabled}, remark = ${remark}, updated_at = now()
    where id = ${id}
  `;
  return { id, name, origin, enabled, remark };
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
