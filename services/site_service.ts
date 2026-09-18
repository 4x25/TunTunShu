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

/** new-api `/api/status` 响应中 data 的公开负载;结构随上游版本浮动,仅作缓存透传。 */
export type NewApiStatusData = Record<string, unknown>;

/**
 * new-api 项目标志性字段(见上游 controller/misc.go GetStatus)。
 * 要求至少命中两项,避免任意返回 200 的页面被误判为 new-api 站点。
 */
const NEW_API_SIGNATURE_KEYS = [
  "version",
  "start_time",
  "system_name",
  "quota_per_unit",
  "email_verification",
] as const;

export function isNewApiStatusData(data: unknown): data is NewApiStatusData {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const hits = NEW_API_SIGNATURE_KEYS.filter((key) => key in data).length;
  return hits >= 2;
}

/** 请求 origin 的 /api/status,取 new-api 站点名称(data.system_name);失败返回 null。 */
export async function fetchSystemName(origin: string): Promise<string | null> {
  try {
    const res = await adapter.getStatus(origin, AbortSignal.timeout(8000));
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
  const needsAccounts = Boolean(
    params.accountQ || params.apiKeyQ || params.modelQ,
  );
  const needsApiKeys = Boolean(params.apiKeyQ || params.modelQ);
  const needsModels = Boolean(params.modelQ);
  const fromSql = `
    from sites
    ${needsAccounts ? "join accounts on accounts.site_id = sites.id" : ""}
    ${needsApiKeys ? "join api_keys on api_keys.account_id = accounts.id" : ""}
    ${
    needsModels
      ? "join upstream_models on upstream_models.api_key_id = api_keys.id"
      : ""
  }
    ${
    needsModels
      ? "left join models on models.id = upstream_models.model_id"
      : ""
  }
  `;
  if (params.siteQ) {
    values.push(`%${params.siteQ}%`);
    where.push(
      `(sites.name ilike $${values.length} or sites.origin ilike $${values.length})`,
    );
  }
  if (params.accountQ) {
    values.push(`%${params.accountQ}%`);
    where.push(
      `(accounts.name ilike $${values.length} or accounts.user_id ilike $${values.length})`,
    );
  }
  if (params.apiKeyQ) {
    values.push(`%${params.apiKeyQ}%`);
    where.push(
      `(api_keys.name ilike $${values.length} or api_keys.key ilike $${values.length})`,
    );
  }
  if (params.modelQ) {
    values.push(`%${params.modelQ}%`);
    where.push(
      `(upstream_models.name ilike $${values.length} or models.name ilike $${values.length})`,
    );
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const countRows = await sql.unsafe<{ count: number }[]>(
    `select count(distinct sites.id)::int as count ${fromSql} ${whereSql}`,
    values,
  );
  const pageValues = [...values, params.pageSize, params.offset];
  const items = await sql.unsafe(
    `select distinct sites.* ${fromSql} ${whereSql}
     order by sites.id desc
     limit $${values.length + 1} offset $${values.length + 2}`,
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

/**
 * 站点健康检查:GET <origin>/api/status(与「自动获取站点名称」同一接口)。
 * 判定healthy 不只看 HTTP 200,还要求 new-api 约定的 `{success:true, data:{...}}`
 * 包裹并通过标志性字段识别(见 isNewApiStatusData);命中时把整个 data
 * 负载落库到 sites.status_data 作为缓存,供后续流程使用,失败时清空。
 */
/**
 * 重读整行站点数据(含 status_data),供检测接口把「检测后」的真实落库状态返回。
 */
async function readSiteRow(id: number) {
  const rows = await getSql()<Record<string, unknown>[]>`
    select * from sites where id = ${id}
  `;
  return rows[0] ?? null;
}

export async function healthCheckSite(id: number) {
  const sql = getSql();
  const rows = await sql<{ id: number; origin: string }[]>`
    select id, origin from sites where id = ${id}
  `;
  const site = rows[0];
  if (!site) return null;
  try {
    const response = await adapter.getStatus(
      site.origin,
      AbortSignal.timeout(10_000),
    );
    const body = await response.json().catch(() => null) as
      | { success?: unknown; data?: unknown }
      | null;
    const data = body?.data;
    const isHealthy = response.ok && body?.success === true &&
      isNewApiStatusData(data);
    const status = isHealthy ? "healthy" : "down";
    const logId = await createSystemTaskLog({
      taskType: "site_health_check",
      status: isHealthy ? "success" : "failed",
      siteId: id,
      message: `http_status=${response.status} new_api=${isHealthy}`,
    });
    await sql`
      update sites
      set status = ${status},
          status_data = ${isHealthy ? JSON.stringify(data) : null}::jsonb,
          last_health_check_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return {
      ok: isHealthy,
      httpStatus: response.status,
      newApi: isHealthy,
      status,
      // 检测接口把整行站点(含 status_data / last_health_check_log_id 等)
      // 原样回传,便于排查。
      site: await readSiteRow(id),
    };
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
      set status = 'down', status_data = null, last_health_check_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return {
      ok: false,
      error: message,
      status: "down",
      site: await readSiteRow(id),
    };
  }
}

/**
 * 记录「站点未开放签到」。依据是上游 /api/user/checkin 的权威业务回执
 * (`签到功能未启用`),比 /api/status 快照更可靠;合并写回 status_data,
 * 保留已有字段,供账号列表置灰按钮与 cron 筛选使用。
 */
export async function markSiteCheckinDisabled(siteId: number) {
  const sql = getSql();
  await sql`
    update sites
    set status_data = coalesce(status_data, '{}'::jsonb) || '{"checkin_enabled": false}'::jsonb,
        updated_at = now()
    where id = ${siteId}
  `;
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
