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
import {
  browserCheckinEnabled,
  browserCheckinTimeoutMs,
  classifyDirectCheckin,
} from "./checkin_classifier.ts";
import {
  acquireBrowserCheckinLease,
  type BrowserCheckinLease,
  type BrowserCheckinLeaseBusy,
} from "./browser_checkin_lease_service.ts";
import {
  type BrowserCheckinCode,
  type BrowserCheckinResult,
  runBrowserCheckin,
} from "./browser_checkin_service.ts";
import { getSettings } from "./settings_service.ts";

const adapter = new NewApiAdapter();
const TOKEN_PAGE_SIZE = 100;

export interface AccountWithOrigin {
  id: number;
  site_id: number;
  user_id: string;
  access_token: string;
  origin: string;
  site_checkin_enabled?: boolean | null;
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
  const needsSites = Boolean(params.siteQ);
  const needsApiKeys = Boolean(params.apiKeyQ || params.modelQ);
  const needsModels = Boolean(params.modelQ);
  const fromSql = `
    from accounts
    ${needsSites ? "join sites on sites.id = accounts.site_id" : ""}
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
  if (params.siteId !== undefined) {
    values.push(params.siteId);
    where.push(`accounts.site_id = $${values.length}`);
  }
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
    `select count(distinct accounts.id)::int as count ${fromSql} ${whereSql}`,
    values,
  );
  const pageValues = [...values, params.pageSize, params.offset];
  const items = await sql.unsafe(
    `select distinct accounts.*,
       (select site_lookup.origin from sites site_lookup
        where site_lookup.id = accounts.site_id) as site_origin,
       (select (site_lookup.status_data->>'checkin_enabled')::boolean
        from sites site_lookup
        where site_lookup.id = accounts.site_id) as site_checkin_enabled
     ${fromSql} ${whereSql}
     order by accounts.id desc
     limit $${values.length + 1} offset $${values.length + 2}`,
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

/** 今日签到记录(来自 new-api /api/user/checkin 的 stats.records)。 */
export interface TodayCheckinRecord {
  checkin_date: string;
  quota_awarded: number | null;
}

export interface TodayCheckinInfo {
  /** new-api 前端同样规则:data.stats.checked_in_today;拿不到定论为 null。 */
  checkedToday: boolean | null;
  /** 已签到时取 records 中最大 checkin_date 的那条;未签到为 null。 */
  record: TodayCheckinRecord | null;
}

/**
 * GET /api/user/checkin,参考 new-api 前端(checkin-calendar-card.tsx)的判定:
 * `data.stats.checked_in_today === true`;records 为当月记录
 * `{checkin_date:"YYYY-MM-DD", quota_awarded:number}`。功能未启用、上游报
 * success:false、字段缺失或请求失败时返回 null,调用方不动本地状态。
 */
async function fetchTodayCheckin(
  auth: { origin: string; userId: string; accessToken: string },
): Promise<TodayCheckinInfo | null> {
  try {
    const res = await adapter.getCheckinStatus(
      {
        origin: auth.origin.replace(/\/+$/, ""),
        userId: auth.userId,
        accessToken: auth.accessToken,
      },
      AbortSignal.timeout(10_000),
    );
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as
      | {
        success?: unknown;
        data?: {
          stats?: {
            checked_in_today?: unknown;
            records?: unknown;
          };
        };
      }
      | null;
    if (body?.success !== true) return null;
    const stats = body.data?.stats;
    const checked = stats?.checked_in_today;
    if (checked !== true && checked !== false) return null;
    let record: TodayCheckinRecord | null = null;
    if (checked && Array.isArray(stats?.records)) {
      for (const item of stats.records) {
        if (typeof item?.checkin_date !== "string") continue;
        const quotaAwarded = typeof item.quota_awarded === "number"
          ? item.quota_awarded
          : null;
        if (!record || item.checkin_date > record.checkin_date) {
          record = {
            checkin_date: item.checkin_date,
            quota_awarded: quotaAwarded,
          };
        }
      }
    }
    return { checkedToday: checked, record };
  } catch {
    return null;
  }
}

/**
 * 账号数据同步(原「额度同步」小重构):与「自动识别账号名」共用
 * GET /api/user/self 接口——刷新额度/已用额度与 accounts.status,并把整个
 * data 负载缓存到 accounts.user_data(失败时清空)供后续流程使用;
 * self 成功后 best-effort 再调 GET /api/user/checkin 同步今日签到状态。
 * 外部表面(cron/任务类型/路由)仍沿用 account_quota_sync 命名,行为见 AGENTS.md。
 */
export async function syncAccountData(id: number) {
  const sql = getSql();
  const rows = await sql<
    {
      id: number;
      site_id: number;
      user_id: string;
      access_token: string;
      checkin_status: string;
      checkin_date: string | null;
      checkin_quota: string | number | null;
      origin: string;
    }[]
  >`
    select accounts.id, accounts.site_id, accounts.user_id, accounts.access_token, accounts.checkin_status, accounts.checkin_date, accounts.checkin_quota, sites.origin
    from accounts
    join sites on sites.id = accounts.site_id
    where accounts.id = ${id}
  `;
  const account = rows[0];
  if (!account) return null;
  const auth = {
    origin: account.origin,
    userId: account.user_id,
    accessToken: account.access_token,
  };
  try {
    const response = await adapter.getUserSelf(auth);
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
    let message = JSON.stringify(data).slice(0, 1000);
    let checkinStatus: "checked" | "unchecked" | null = null;
    // 今日签到记录:已签到时为今日 date/quota;未签到时清空;拿不到定论时保留原值。
    let checkinDate: string | null = account.checkin_date;
    let checkinQuota: string | number | null = account.checkin_quota;
    if (ok) {
      const info = await fetchTodayCheckin(auth);
      if (info === null || info.checkedToday === null) {
        message += " checked_in_today=na";
      } else if (info.checkedToday) {
        checkinStatus = "checked";
        checkinDate = info.record?.checkin_date ?? null;
        checkinQuota = info.record?.quota_awarded ?? null;
        message += " checked_in_today=true";
      } else if (
        account.checkin_status === "manual_required" ||
        account.checkin_status === "failed"
      ) {
        // 未签到时不覆盖 manual_required/failed——它们是本系统自己标记的
        // 「需人工处理/浏览器签到失败」,比上游布尔状态更有信息量。
        checkinDate = null;
        checkinQuota = null;
        message += " checked_in_today=false (preserved)";
      } else {
        checkinStatus = "unchecked";
        checkinDate = null;
        checkinQuota = null;
        message += " checked_in_today=false";
      }
    }
    const logId = await createSystemTaskLog({
      taskType: "account_quota_sync",
      status: ok ? "success" : "failed",
      siteId: account.site_id,
      accountId: account.id,
      message,
    });
    await sql`
      update accounts
      set quota = ${quota}, used_quota = ${usedQuota}, status = ${status},
          user_data = ${ok ? JSON.stringify(payload) : null}::jsonb,
          checkin_status = ${checkinStatus ?? account.checkin_status},
          checkin_date = ${checkinDate},
          checkin_quota = ${checkinQuota},
          last_quota_sync_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return { ok, quota, usedQuota, status, checkinStatus, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logId = await createSystemTaskLog({
      taskType: "account_quota_sync",
      status: "failed",
      siteId: account.site_id,
      accountId: account.id,
      message,
    });
    await sql`update accounts set status = 'invalid', user_data = null, last_quota_sync_log_id = ${logId}, updated_at = now() where id = ${id}`;
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
 * 单账号数据同步(账号数据 ‖ 拉 Key)——cron `account_quota_sync` 与手动「检测」
 * 按钮共用。两者分写 accounts / api_keys+upstream_models,互不冲突;拉 Key 仅对
 * 本轮新增 Key 顺带拉模型,存量 Key 由 `api_key_model_sync` cron 负责。
 */
export async function syncAccount(id: number) {
  const [data, keys] = await Promise.all([
    syncAccountData(id),
    syncAccountApiKeys(id),
  ]);
  return {
    ok: data?.ok === true && keys?.ok === true,
    data,
    keys,
  };
}

/**
 * 创建/编辑账号后的完整刷新:(账号数据 ‖ 拉 ApiKey) → 账号下所有 Key 并发拉模型。
 * 唯一依赖:模型须在 ApiKey 就绪后才能拉。各子步骤自身 try/catch、不抛错并写
 * system_task_logs,故为 best-effort,Promise.all 不会 reject。
 */
export async function refreshAccount(id: number) {
  const sql = getSql();
  // 账号数据与 ApiKey 互不依赖(分别只写 accounts / api_keys),并发执行
  const [data, keys] = await Promise.all([
    syncAccountData(id),
    syncAccountApiKeys(id, { syncNewModels: false }),
  ]);
  // ApiKey 拉完后,账号下每个 Key 并发拉模型(各自作用于不同 api_key 的 upstream_models)
  const rows = await sql<{ id: number }[]>`
    select id from api_keys where account_id = ${id}
  `;
  const models = await Promise.all(rows.map((r) => syncApiKeyModels(r.id)));
  return { data, keys, models };
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

type CheckinTaskStatus = "success" | "failed" | "skipped";
type CheckinMethod = "direct" | "browser";

export interface CheckinAutomation {
  attempted: boolean;
  code: BrowserCheckinCode | "disabled" | "busy";
  durationMs: number;
}

export interface AccountCheckinExecution {
  checkinStatus: CheckinStatus;
  taskStatus: CheckinTaskStatus;
  checkinMethod: CheckinMethod;
  message: string;
  status?: number;
  body?: string;
  error?: string;
  automation?: CheckinAutomation;
  skipped?: boolean;
}

export interface CheckinDependencies {
  loadSettings: typeof getSettings;
  directCheckin: (
    auth: NewApiUserAuth,
    signal: AbortSignal,
  ) => Promise<Response>;
  acquireLease: (options: {
    maxWaitMs: number;
    ttlMs: number;
    heartbeatMs: number;
  }) => Promise<BrowserCheckinLease | BrowserCheckinLeaseBusy>;
  browserCheckin: (input: {
    origin: string;
    userId: string;
    accessToken: string;
    timeoutMs: number;
  }) => Promise<BrowserCheckinResult>;
  now: () => number;
}

const defaultCheckinDependencies: CheckinDependencies = {
  loadSettings: getSettings,
  directCheckin: (auth, signal) => adapter.checkin(auth, signal),
  acquireLease: (options) => acquireBrowserCheckinLease(options),
  browserCheckin: runBrowserCheckin,
  now: () => performance.now(),
};

function failedExecution(error: unknown): AccountCheckinExecution {
  const message = errorMessage(error);
  return {
    checkinStatus: "failed",
    taskStatus: "failed",
    checkinMethod: "direct",
    message,
    error: message,
  };
}

/**
 * Execute direct check-in plus the optional browser fallback without touching
 * account/log tables. Dependency injection keeps orchestration testable.
 */
export async function executeAccountCheckin(
  account: AccountWithOrigin,
  dependencies: Partial<CheckinDependencies> = {},
): Promise<AccountCheckinExecution> {
  const deps = { ...defaultCheckinDependencies, ...dependencies };
  // 站点明确未开放签到时直接跳过,不直连、也不启动浏览器。
  if (account.site_checkin_enabled === false) {
    return {
      checkinStatus: "unknown",
      taskStatus: "skipped",
      checkinMethod: "direct",
      message: "站点未开放签到功能",
      skipped: true,
    };
  }
  let settings: Awaited<ReturnType<typeof getSettings>>;
  let response: Response;
  try {
    settings = await deps.loadSettings();
    response = await deps.directCheckin(
      accountAuth(account),
      AbortSignal.timeout(15_000),
    );
  } catch (error) {
    return failedExecution(error);
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    return failedExecution(error);
  }
  const direct = classifyDirectCheckin({
    status: response.status,
    headers: response.headers,
    body,
  });
  const directBase = { status: response.status, body };
  if (direct.kind === "checked") {
    return {
      ...directBase,
      checkinStatus: "checked",
      taskStatus: "success",
      checkinMethod: "direct",
      message: direct.message,
    };
  }
  if (direct.kind === "failed") {
    return {
      ...directBase,
      checkinStatus: "failed",
      taskStatus: "failed",
      checkinMethod: "direct",
      message: direct.message,
    };
  }

  if (!browserCheckinEnabled(settings.browser_checkin_enabled)) {
    return {
      ...directBase,
      checkinStatus: "manual_required",
      taskStatus: "skipped",
      checkinMethod: "direct",
      message: `${direct.message}；浏览器自动签到未启用`,
      automation: { attempted: false, code: "disabled", durationMs: 0 },
    };
  }

  const timeoutMs = browserCheckinTimeoutMs(
    settings.browser_checkin_timeout_seconds,
  );
  const automationStartedAt = deps.now();
  let lease: BrowserCheckinLease | BrowserCheckinLeaseBusy;
  try {
    lease = await deps.acquireLease({
      maxWaitMs: Math.min(10_000, timeoutMs),
      ttlMs: 150_000,
      heartbeatMs: 20_000,
    });
  } catch {
    const durationMs = Math.max(0, deps.now() - automationStartedAt);
    return {
      ...directBase,
      checkinStatus: "manual_required",
      taskStatus: "failed",
      checkinMethod: "direct",
      message: `${direct.message}；浏览器自动签到租约不可用`,
      automation: {
        attempted: false,
        code: "internal_error",
        durationMs,
      },
    };
  }
  if (!lease.acquired) {
    return {
      ...directBase,
      checkinStatus: "manual_required",
      taskStatus: "skipped",
      checkinMethod: "direct",
      message: `${direct.message}；浏览器自动签到繁忙`,
      automation: {
        attempted: false,
        code: "busy",
        durationMs: Math.max(lease.waitedMs, deps.now() - automationStartedAt),
      },
    };
  }

  const elapsedBeforeBrowser = Math.max(0, deps.now() - automationStartedAt);
  const remainingMs = timeoutMs - elapsedBeforeBrowser;
  if (remainingMs <= 0) {
    await lease.release().catch(() => undefined);
    return {
      ...directBase,
      checkinStatus: "manual_required",
      taskStatus: "skipped",
      checkinMethod: "direct",
      message: `${direct.message}；浏览器自动签到繁忙`,
      automation: {
        attempted: false,
        code: "busy",
        durationMs: Math.max(timeoutMs, deps.now() - automationStartedAt),
      },
    };
  }

  const stopHeartbeat = lease.startHeartbeat();
  let browserResult: BrowserCheckinResult;
  let quarantineLease = false;
  try {
    browserResult = await deps.browserCheckin({
      origin: account.origin,
      userId: account.user_id,
      accessToken: account.access_token,
      timeoutMs: remainingMs,
    });
    quarantineLease = browserResult.code === "cleanup_failed";
  } catch {
    browserResult = {
      ok: false,
      code: "internal_error",
      message: "浏览器执行器异常",
      durationMs: Math.max(0, deps.now() - automationStartedAt),
    };
  } finally {
    try {
      stopHeartbeat();
    } finally {
      if (quarantineLease) {
        lease.abandon();
      } else {
        await lease.release().catch(() => undefined);
      }
    }
  }

  const automation: CheckinAutomation = {
    attempted: true,
    code: browserResult.code,
    durationMs: Math.max(0, deps.now() - automationStartedAt),
  };
  const duration = `${(automation.durationMs / 1000).toFixed(1)}s`;
  if (browserResult.ok) {
    return {
      ...directBase,
      checkinStatus: "checked",
      taskStatus: "success",
      checkinMethod: "browser",
      message:
        `${direct.message}；浏览器自动签到成功 (${browserResult.code}, ${duration}): ${
          browserResult.message || "签到成功"
        }`,
      automation,
    };
  }
  return {
    ...directBase,
    checkinStatus: "manual_required",
    taskStatus: "failed",
    checkinMethod: "browser",
    message:
      `${direct.message}；浏览器自动签到失败 (${browserResult.code}, ${duration}): ${browserResult.message}`,
    automation,
  };
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
      site_checkin_enabled: boolean | null;
    }[]
  >`
    select accounts.id, accounts.site_id, accounts.user_id, accounts.access_token, sites.origin,
      (sites.status_data->>'checkin_enabled')::boolean as site_checkin_enabled
    from accounts
    join sites on sites.id = accounts.site_id
    where accounts.id = ${id}
  `;
  const account = rows[0];
  if (!account) return null;
  const result = await executeAccountCheckin(account);
  // One invocation produces exactly one final log, even when direct check-in
  // falls back to the browser. Attempts are summarized in message/automation.
  const logId = await createSystemTaskLog({
    taskType: "account_checkin",
    status: result.taskStatus,
    siteId: account.site_id,
    accountId: account.id,
    message: result.message.slice(0, 1000),
  });
  // 签到成功后 best-effort 回拉今日记录(日期/收获额度),供前端「已签到」tip 使用;
  // 拉不到时置空,后续账号数据同步会补上。
  let checkinDate: string | null = null;
  let checkinQuota: number | null = null;
  if (result.checkinStatus === "checked") {
    const info = await fetchTodayCheckin(accountAuth(account)).catch(() =>
      null
    );
    if (info?.checkedToday) {
      checkinDate = info.record?.checkin_date ?? null;
      checkinQuota = info.record?.quota_awarded ?? null;
    }
  }
  await sql`update accounts set checkin_status = ${result.checkinStatus}, checkin_date = ${checkinDate}, checkin_quota = ${checkinQuota}, last_checkin_log_id = ${logId}, updated_at = now() where id = ${id}`;
  return {
    ok: result.checkinStatus === "checked",
    ...(result.status === undefined ? {} : { status: result.status }),
    checkinStatus: result.checkinStatus,
    message: result.message,
    ...(result.body === undefined ? {} : { body: result.body }),
    ...(result.error === undefined ? {} : { error: result.error }),
    checkinMethod: result.checkinMethod,
    ...(result.automation === undefined
      ? {}
      : { automation: result.automation }),
    ...(result.skipped === undefined ? {} : { skipped: result.skipped }),
  };
}
