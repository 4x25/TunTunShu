import { getSql } from "../db/client.ts";
import {
  NewApiAdapter,
  type NewApiUserAuth,
} from "../adapters/new_api_adapter.ts";
import { type PageParams, pageResult } from "../lib/pagination.ts";
import { createSystemTaskLog } from "./system_task_log_service.ts";
import { syncApiKeyModels } from "./api_key_service.ts";
import { isUniqueViolation } from "./site_service.ts";
import type { CheckinStatus } from "../types/enums.ts";

const adapter = new NewApiAdapter();
const TOKEN_PAGE_SIZE = 100;

interface AccountWithOrigin {
  id: number;
  site_id: number;
  user_id: string;
  access_token: string;
  origin: string;
}

interface UpstreamToken {
  id: number;
  name?: string;
  status?: number;
  key?: string;
}

interface AccountApiKeySyncResult {
  ok: boolean;
  count: number;
  newKeys?: number;
  pruned?: number;
  modelSyncs?: Awaited<ReturnType<typeof syncApiKeyModels>>[];
  error?: string;
}

interface SyncAccountApiKeysOptions {
  syncNewModels?: boolean;
}

function accountAuth(account: AccountWithOrigin): NewApiUserAuth {
  return {
    origin: account.origin,
    userId: account.user_id,
    accessToken: account.access_token,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function responseMessage(
  data: { message?: unknown },
  fallback: string,
): string {
  return typeof data.message === "string" && data.message.trim()
    ? data.message
    : fallback;
}

function upstreamFailure(
  action: string,
  response: Response,
  data: { message?: unknown },
): string {
  return `${action}失败: ${responseMessage(data, `HTTP ${response.status}`)}`;
}

function tokenEnabled(status: number | undefined): boolean {
  return typeof status === "number" ? status === 1 : true;
}

function tokenLocalStatus(status: number | undefined): string {
  if (status === 3) return "invalid";
  if (status === 4) return "quota_empty";
  return "healthy";
}

function normalizeListedTokenKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed || trimmed.includes("*")) return null;
  return trimmed;
}

async function findAccountWithOrigin(
  id: number,
): Promise<AccountWithOrigin | null> {
  const sql = getSql();
  const rows = await sql<AccountWithOrigin[]>`
    select accounts.id, accounts.site_id, accounts.user_id, accounts.access_token, sites.origin
    from accounts
    join sites on sites.id = accounts.site_id
    where accounts.id = ${id}
  `;
  return rows[0] ?? null;
}

async function listAllAccountTokens(
  account: AccountWithOrigin,
): Promise<UpstreamToken[]> {
  const tokens: UpstreamToken[] = [];
  let seenItems = 0;
  let page = 1;
  while (true) {
    const response = await adapter.listTokens(
      accountAuth(account),
      page,
      TOKEN_PAGE_SIZE,
    );
    const data = await response.json().catch(() => ({})) as {
      success?: boolean;
      message?: unknown;
      data?: {
        total?: number;
        items?: Array<{
          id?: number;
          name?: string;
          status?: number;
          key?: string;
        }>;
      };
    };
    if (!response.ok || data.success !== true) {
      throw new Error(upstreamFailure("列出上游 APIKey", response, data));
    }

    const items = Array.isArray(data.data?.items) ? data.data.items : [];
    seenItems += items.length;
    for (const item of items) {
      if (typeof item.id !== "number") continue;
      tokens.push({
        id: item.id,
        name: item.name,
        status: item.status,
        key: typeof item.key === "string"
          ? normalizeListedTokenKey(item.key) ??
            undefined
          : undefined,
      });
    }

    const total = typeof data.data?.total === "number" ? data.data.total : null;
    if (items.length === 0) break;
    if (total != null && seenItems >= total) break;
    if (items.length < TOKEN_PAGE_SIZE) break;
    page += 1;
  }
  return tokens;
}

/** 请求 origin 的 /api/user/self,取 new-api 用户名(data.username);失败返回 null。 */
export async function fetchUsername(
  auth: { origin: string; userId: string; accessToken: string },
): Promise<string | null> {
  try {
    const res = await adapter.getUserSelf(
      {
        origin: auth.origin.replace(/\/+$/, ""),
        userId: auth.userId,
        accessToken: auth.accessToken,
      },
      AbortSignal.timeout(8000),
    );
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as
      | { data?: { username?: unknown } }
      | null;
    const name = body?.data?.username;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** upsert 结果:updated=true 表示命中 (site_id, user_id) 唯一键、就地更新了已有账号。 */
export type CreateAccountResult = { id: number; updated: boolean };

export async function createAccount(input: {
  siteId: number;
  name?: string | null;
  userId: string;
  accessToken: string;
}): Promise<CreateAccountResult> {
  const sql = getSql();

  // 命中已有 (site_id, user_id) 时就地更新:token 必更新、name 有才覆盖。
  const mergeUpdate = async (id: number): Promise<CreateAccountResult> => {
    await updateAccount(id, {
      accessToken: input.accessToken,
      name: input.name?.trim() || undefined,
    });
    return { id, updated: true };
  };

  // 查重前置:命中即更新,省去对已存在账号还白白发起 /api/user/self 取名。
  const existing = await sql<{ id: number }[]>`
    select id from accounts
    where site_id = ${input.siteId} and user_id = ${input.userId}
    limit 1
  `;
  if (existing[0]) return await mergeUpdate(existing[0].id);

  // 账号名称非必填:留空时取 origin/api/user/self 的 username,再退回 userId。
  let name = input.name?.trim() || null;
  if (!name) {
    const site = await sql<{ origin: string }[]>`
      select origin from sites where id = ${input.siteId}
    `;
    if (site[0]) {
      name = await fetchUsername({
        origin: site[0].origin,
        userId: input.userId,
        accessToken: input.accessToken,
      });
    }
    name = name || input.userId;
  }
  try {
    const rows = await sql<{ id: number }[]>`
      insert into accounts (site_id, name, user_id, access_token)
      values (${input.siteId}, ${name}, ${input.userId}, ${input.accessToken})
      returning id
    `;
    const inserted = rows[0];
    if (!inserted) throw new Error("createAccount: insert 未返回新行");
    return { id: inserted.id, updated: false };
  } catch (error) {
    // 并发兜底:两请求同时通过查重,撞唯一索引(23505)→ 改走更新。
    if (isUniqueViolation(error)) {
      const dup = await sql<{ id: number }[]>`
        select id from accounts
        where site_id = ${input.siteId} and user_id = ${input.userId}
        limit 1
      `;
      if (dup[0]) return await mergeUpdate(dup[0].id);
    }
    throw error;
  }
}

/**
 * 编辑账号时按账号 id 自动补全用户名:origin 取自账号所属站点;userId/accessToken
 * 留空则用库里已存的(配合「AccessToken 留空不修改」)。失败返回 null。
 */
export async function probeAccountUsername(
  id: number,
  overrides: { userId?: string; accessToken?: string },
): Promise<string | null> {
  const sql = getSql();
  const rows = await sql<
    { user_id: string; access_token: string; origin: string }[]
  >`
    select accounts.user_id, accounts.access_token, sites.origin
    from accounts
    join sites on sites.id = accounts.site_id
    where accounts.id = ${id}
  `;
  const acct = rows[0];
  if (!acct) return null;
  return await fetchUsername({
    origin: acct.origin,
    userId: overrides.userId?.trim() || acct.user_id,
    accessToken: overrides.accessToken?.trim() || acct.access_token,
  });
}

export async function listAccounts(params: PageParams) {
  const sql = getSql();
  const values: Array<number | string> = [];
  const where: string[] = [];
  if (params.siteId !== undefined) {
    values.push(params.siteId);
    where.push(`site_id = $${values.length}`);
  }
  if (params.q) {
    values.push(`%${params.q}%`);
    where.push(
      `(name ilike $${values.length} or user_id ilike $${values.length})`,
    );
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const countRows = await sql.unsafe<{ count: number }[]>(
    `select count(*)::int as count from accounts ${whereSql}`,
    values,
  );
  const pageValues = [...values, params.pageSize, params.offset];
  const items = await sql.unsafe(
    `select * from accounts ${whereSql} order by id desc limit $${
      values.length + 1
    } offset $${values.length + 2}`,
    pageValues,
  );
  return pageResult(items, params, Number(countRows[0]?.count ?? 0));
}

export async function updateAccount(
  id: number,
  input: {
    name?: string;
    userId?: string;
    accessToken?: string;
    enabled?: boolean;
  },
) {
  const sql = getSql();
  const current = await sql<
    {
      name: string;
      user_id: string;
      access_token: string;
      enabled: boolean;
    }[]
  >`select name, user_id, access_token, enabled from accounts where id = ${id}`;
  if (!current[0]) return null;
  const name = input.name ?? current[0].name;
  const userId = input.userId ?? current[0].user_id;
  const accessToken = input.accessToken ?? current[0].access_token;
  const enabled = input.enabled ?? current[0].enabled;
  await sql`
    update accounts
    set name = ${name}, user_id = ${userId}, access_token = ${accessToken}, enabled = ${enabled}, updated_at = now()
    where id = ${id}
  `;
  return { id, name, userId, enabled };
}

export async function syncAccountQuota(id: number) {
  const sql = getSql();
  const rows = await sql<
    {
      id: number;
      site_id: number;
      user_id: string;
      access_token: string;
      origin: string;
    }[]
  >`
    select accounts.id, accounts.site_id, accounts.user_id, accounts.access_token, sites.origin
    from accounts
    join sites on sites.id = accounts.site_id
    where accounts.id = ${id}
  `;
  const account = rows[0];
  if (!account) return null;
  try {
    const response = await adapter.getUserSelf({
      origin: account.origin,
      userId: account.user_id,
      accessToken: account.access_token,
    });
    const data = await response.json().catch(() => ({})) as Record<
      string,
      unknown
    >;
    const payload = typeof data.data === "object" && data.data
      ? data.data as Record<string, unknown>
      : data;
    const quota = Number(payload.quota ?? 0);
    const usedQuota = Number(payload.used_quota ?? payload.usedQuota ?? 0);
    // new-api 即使 access token 失效也返回 HTTP 200,业务成败在 body.success,
    // 故不能只看 response.ok,否则 {"success":false,...} 会被误判为成功。
    const ok = response.ok && data.success === true;
    const status = ok ? quota === 0 ? "quota_empty" : "healthy" : "invalid";
    const logId = await createSystemTaskLog({
      taskType: "account_quota_sync",
      status: ok ? "success" : "failed",
      siteId: account.site_id,
      accountId: account.id,
      message: JSON.stringify(data).slice(0, 1000),
    });
    await sql`
      update accounts
      set quota = ${quota}, used_quota = ${usedQuota}, status = ${status}, last_quota_sync_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return { ok, quota, usedQuota, status, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logId = await createSystemTaskLog({
      taskType: "account_quota_sync",
      status: "failed",
      siteId: account.site_id,
      accountId: account.id,
      message,
    });
    await sql`update accounts set status = 'invalid', last_quota_sync_log_id = ${logId}, updated_at = now() where id = ${id}`;
    return { ok: false, error: message };
  }
}

export async function syncAccountApiKeys(
  id: number,
  options: SyncAccountApiKeysOptions = {},
): Promise<AccountApiKeySyncResult | null> {
  const sql = getSql();
  const account = await findAccountWithOrigin(id);
  if (!account) return null;

  try {
    const tokens = await listAllAccountTokens(account);
    let synced = 0;
    const syncedLocalIds = new Set<number>();
    const newModelKeyIds: number[] = [];

    for (const item of tokens) {
      let key = item.key;
      if (!key) {
        const keyResponse = await adapter.getTokenKey({
          origin: account.origin,
          userId: account.user_id,
          accessToken: account.access_token,
        }, item.id);
        const keyData = await keyResponse.json().catch(() => ({})) as {
          success?: boolean;
          message?: unknown;
          data?: { key?: string };
        };
        key = keyData.data?.key;
        if (!keyResponse.ok || keyData.success !== true || !key) {
          throw new Error(
            upstreamFailure("读取上游 APIKey 明文", keyResponse, keyData),
          );
        }
      }
      const name = item.name ?? `Token ${item.id}`;
      const enabled = tokenEnabled(item.status);
      const status = tokenLocalStatus(item.status);
      const existing = await sql<{ id: number }[]>`
        select id from api_keys where account_id = ${id} and key = ${key} limit 1
      `;
      if (existing[0]) {
        await sql`
          update api_keys
          set name = ${name}, enabled = ${enabled}, status = ${status}, updated_at = now()
          where id = ${existing[0].id}
        `;
        syncedLocalIds.add(existing[0].id);
      } else {
        const inserted = await sql<{ id: number }[]>`
          insert into api_keys (account_id, name, key, enabled, status)
          values (${id}, ${name}, ${key}, ${enabled}, ${status})
          returning id
        `;
        if (inserted[0]) {
          syncedLocalIds.add(inserted[0].id);
          if (enabled) newModelKeyIds.push(inserted[0].id);
        }
      }
      synced += 1;
    }

    let pruned = 0;
    const localKeys = await sql<{ id: number }[]>`
      select id from api_keys where account_id = ${id}
    `;
    for (const local of localKeys) {
      if (syncedLocalIds.has(local.id)) continue;
      await sql`delete from upstream_models where api_key_id = ${local.id}`;
      await sql`delete from api_keys where id = ${local.id}`;
      pruned += 1;
    }

    const modelSyncs = options.syncNewModels ?? true
      ? await Promise.all(
        newModelKeyIds.map((keyId) => syncApiKeyModels(keyId)),
      )
      : [];

    await createSystemTaskLog({
      taskType: "account_api_key_sync",
      status: "success",
      siteId: account.site_id,
      accountId: account.id,
      message:
        `api_keys=${synced} new_keys=${newModelKeyIds.length} pruned=${pruned} model_syncs=${modelSyncs.length}`,
    });
    return {
      ok: true,
      count: synced,
      newKeys: newModelKeyIds.length,
      pruned,
      modelSyncs,
    };
  } catch (error) {
    const message = errorMessage(error);
    await createSystemTaskLog({
      taskType: "account_api_key_sync",
      status: "failed",
      siteId: account.site_id,
      accountId: account.id,
      message,
    });
    return { ok: false, count: 0, error: message };
  }
}

/**
 * 创建/编辑账号后的完整刷新：(额度 ‖ 拉 ApiKey) → 账号下所有 Key 并发拉模型。
 * 唯一依赖:模型须在 ApiKey 就绪后才能拉。各子步骤自身 try/catch、不抛错并写
 * system_task_logs,故为 best-effort,Promise.all 不会 reject。
 */
export async function refreshAccount(id: number) {
  const sql = getSql();
  // 额度与 ApiKey 互不依赖(分别只写 accounts / api_keys),并发执行
  const [quota, keys] = await Promise.all([
    syncAccountQuota(id),
    syncAccountApiKeys(id, { syncNewModels: false }),
  ]);
  // ApiKey 拉完后,账号下每个 Key 并发拉模型(各自作用于不同 api_key 的 upstream_models)
  const rows = await sql<{ id: number }[]>`
    select id from api_keys where account_id = ${id}
  `;
  const models = await Promise.all(rows.map((r) => syncApiKeyModels(r.id)));
  return { quota, keys, models };
}

export async function deleteAccount(id: number) {
  const sql = getSql();
  const apiKeys = await sql<
    { id: number }[]
  >`select id from api_keys where account_id = ${id}`;
  for (const apiKey of apiKeys) {
    await sql`delete from upstream_models where api_key_id = ${apiKey.id}`;
  }
  await sql`delete from api_keys where account_id = ${id}`;
  await sql`delete from accounts where id = ${id}`;
}

interface CheckinResult {
  success: boolean;
  message: string;
  quotaAwarded: number | null;
}

/** new-api 签到接口 HTTP 恒为 200,业务结果在 body;非 JSON(站点异常)返回 null。 */
function parseCheckinResult(text: string): CheckinResult | null {
  try {
    const obj = JSON.parse(text) as {
      success?: boolean;
      message?: string;
      data?: { quota_awarded?: number } | null;
    };
    if (typeof obj?.success !== "boolean") return null;
    return {
      success: obj.success,
      message: obj.message ?? "",
      quotaAwarded: typeof obj.data?.quota_awarded === "number"
        ? obj.data.quota_awarded
        : null,
    };
  } catch {
    return null;
  }
}

export async function checkinAccount(id: number) {
  const sql = getSql();
  const rows = await sql<
    {
      id: number;
      site_id: number;
      user_id: string;
      access_token: string;
      origin: string;
    }[]
  >`
    select accounts.id, accounts.site_id, accounts.user_id, accounts.access_token, sites.origin
    from accounts
    join sites on sites.id = accounts.site_id
    where accounts.id = ${id}
  `;
  const account = rows[0];
  if (!account) return null;
  try {
    const response = await adapter.checkin({
      origin: account.origin,
      userId: account.user_id,
      accessToken: account.access_token,
    });
    const text = await response.text();
    const parsed = parseCheckinResult(text);

    let checkinStatus: CheckinStatus;
    let taskStatus: "success" | "failed" | "skipped";
    let message: string;

    if (!parsed) {
      // body 非 JSON(站点挂掉返回 HTML、网关错误等)
      checkinStatus = "failed";
      taskStatus = "failed";
      message = text.slice(0, 1000) || `http ${response.status}`;
    } else if (parsed.success) {
      checkinStatus = "checked";
      taskStatus = "success";
      message = parsed.quotaAwarded != null
        ? `签到成功 +${parsed.quotaAwarded}`
        : (parsed.message || "签到成功");
    } else if (/已签到|已经签到|已签/.test(parsed.message)) {
      // 今日已签到,视为已完成,不算失败
      checkinStatus = "checked";
      taskStatus = "success";
      message = parsed.message || "今日已签到";
    } else if (/turnstile|captcha|验证码|人机验证/i.test(parsed.message)) {
      // 需要人机验证,自动签到无法完成
      checkinStatus = "manual_required";
      taskStatus = "skipped";
      message = parsed.message;
    } else {
      // 其他业务失败(如「签到功能未启用」)
      checkinStatus = "failed";
      taskStatus = "failed";
      message = parsed.message || text.slice(0, 1000);
    }

    const logId = await createSystemTaskLog({
      taskType: "account_checkin",
      status: taskStatus,
      siteId: account.site_id,
      accountId: account.id,
      message: message.slice(0, 1000),
    });
    await sql`update accounts set checkin_status = ${checkinStatus}, last_checkin_log_id = ${logId}, updated_at = now() where id = ${id}`;
    return {
      ok: checkinStatus === "checked",
      status: response.status,
      checkinStatus,
      message,
      body: text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logId = await createSystemTaskLog({
      taskType: "account_checkin",
      status: "failed",
      siteId: account.site_id,
      accountId: account.id,
      message,
    });
    await sql`update accounts set checkin_status = 'failed', last_checkin_log_id = ${logId}, updated_at = now() where id = ${id}`;
    return { ok: false, error: message };
  }
}
