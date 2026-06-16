import { getSql } from "../db/client.ts";
import { NewApiAdapter } from "../adapters/new_api_adapter.ts";
import { createSystemTaskLog } from "./system_task_log_service.ts";
import type { CheckinStatus } from "../types/enums.ts";

const adapter = new NewApiAdapter();

export async function createAccount(input: {
  siteId: number;
  name: string;
  userId: string;
  accessToken: string;
}) {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    insert into accounts (site_id, name, user_id, access_token)
    values (${input.siteId}, ${input.name}, ${input.userId}, ${input.accessToken})
    returning id
  `;
  return rows[0]?.id ?? null;
}

export async function listAccounts() {
  const sql = getSql();
  return await sql`
    select * from accounts order by id desc
  `;
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
    const status = response.ok
      ? quota === 0 ? "quota_empty" : "healthy"
      : "invalid";
    const logId = await createSystemTaskLog({
      taskType: "account_quota_sync",
      status: response.ok ? "success" : "failed",
      siteId: account.site_id,
      accountId: account.id,
      message: JSON.stringify(data).slice(0, 1000),
    });
    await sql`
      update accounts
      set quota = ${quota}, used_quota = ${usedQuota}, status = ${status}, last_quota_sync_log_id = ${logId}, updated_at = now()
      where id = ${id}
    `;
    return { ok: response.ok, quota, usedQuota, status, data };
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

export async function syncAccountApiKeys(id: number) {
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
    const response = await adapter.listTokens({
      origin: account.origin,
      userId: account.user_id,
      accessToken: account.access_token,
    });
    const data = await response.json().catch(() => ({})) as {
      data?: { items?: Array<{ id?: number; name?: string }> };
    };
    const items = Array.isArray(data.data?.items) ? data.data.items : [];
    let synced = 0;

    for (const item of items) {
      if (!item.id) continue;
      const keyResponse = await adapter.getTokenKey({
        origin: account.origin,
        userId: account.user_id,
        accessToken: account.access_token,
      }, item.id);
      const keyData = await keyResponse.json().catch(() => ({})) as {
        data?: { key?: string };
      };
      const key = keyData.data?.key;
      if (!key) continue;
      const existing = await sql<{ id: number }[]>`
        select id from api_keys where account_id = ${id} and key = ${key} limit 1
      `;
      if (existing[0]) {
        await sql`
          update api_keys
          set name = ${
          item.name ?? `Token ${item.id}`
        }, status = 'healthy', updated_at = now()
          where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into api_keys (account_id, name, key, status)
          values (${id}, ${item.name ?? `Token ${item.id}`}, ${key}, 'healthy')
        `;
      }
      synced += 1;
    }

    await createSystemTaskLog({
      taskType: "account_api_key_sync",
      status: response.ok ? "success" : "failed",
      siteId: account.site_id,
      accountId: account.id,
      message: `api_keys=${synced}`,
    });
    return { ok: response.ok, count: synced };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await createSystemTaskLog({
      taskType: "account_api_key_sync",
      status: "failed",
      siteId: account.site_id,
      accountId: account.id,
      message,
    });
    return { ok: false, error: message };
  }
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
