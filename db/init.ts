import { getSql } from "./client.ts";

/**
 * 把「被双重编码」的 jsonb 缓存还原成对象(供 initializeDatabase 的历史数据修复)。
 *
 * 历史 bug:写入用的是 `${JSON.stringify(x)}::jsonb`,而 postgres 驱动会按
 * Postgres 推断出的参数类型(jsonb)把参数**再** JSON.stringify 一次,于是存进去的
 * 是 jsonb **字符串**而不是对象,`status_data->>'checkin_enabled'` 之类取值恒为
 * NULL。若这种值之后又被 `coalesce(...) || '{"..."}'::jsonb` 合并过,还会变成
 * 数组 `["<json 文本>", {...}]`。
 *
 * 这里两种形态都还原:逐个解析可解析的元素(字符串先 JSON.parse),按顺序合并成
 * 一个对象;完全没有可解析对象时返回 undefined(表示不该改动该行)。
 */
export function repairJsonCache(
  value: unknown,
): Record<string, unknown> | undefined {
  const candidates = Array.isArray(value) ? value : [value];
  let merged: Record<string, unknown> | undefined;
  for (const candidate of candidates) {
    let parsed: unknown = candidate;
    if (typeof candidate === "string") {
      try {
        parsed = JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      merged = { ...(merged ?? {}), ...(parsed as Record<string, unknown>) };
    }
  }
  return merged;
}

export async function initializeDatabase() {
  const sql = getSql();
  await sql`
    create table if not exists sites (
      id bigserial primary key,
      name text not null,
      origin text not null,
      enabled boolean not null default true,
      status text not null default 'unknown',
      last_health_check_log_id bigint,
      remark text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  // origin 唯一索引(并发兜底)。表用 `create table if not exists` 建,列级 unique 对
  // 已存在的库不会补上,故单独建索引。若历史数据已有重复 origin 会建失败 —— 此处吞掉
  // 并告警,避免阻塞启动;清理重复后下次启动会自动补建。
  try {
    await sql`
      create unique index if not exists sites_origin_key on sites (origin)
    `;
  } catch (error) {
    console.warn(
      "[init] 无法创建 sites.origin 唯一索引(可能存在重复 origin,清理后重启即可补建):",
      error,
    );
  }
  await sql`
    create table if not exists accounts (
      id bigserial primary key,
      site_id bigint not null,
      name text not null,
      user_id text not null,
      access_token text not null,
      enabled boolean not null default true,
      status text not null default 'unknown',
      quota bigint not null default 0,
      used_quota bigint not null default 0,
      checkin_status text not null default 'unknown',
      last_checkin_log_id bigint,
      last_quota_sync_log_id bigint,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  // (site_id, user_id) 复合唯一索引(upsert 兜底)。同 sites_origin_key:列级 unique 对
  // 已存在的库不会补上,故单独建索引。历史数据若已有重复账号会建失败 —— 吞掉并告警,
  // 清理重复后下次启动自动补建。
  try {
    await sql`
      create unique index if not exists accounts_site_user_key
        on accounts (site_id, user_id)
    `;
  } catch (error) {
    console.warn(
      "[init] 无法创建 accounts (site_id,user_id) 唯一索引(可能存在重复账号,清理后重启即可补建):",
      error,
    );
  }
  await sql`
    create index if not exists accounts_site_id_id_idx
      on accounts (site_id, id desc)
  `;
  // CloakBrowser 签到全局租约。owner + 过期时间允许多实例原子争抢并在崩溃后自愈。
  await sql`
    create table if not exists browser_checkin_leases (
      name text primary key,
      owner text not null,
      expires_at timestamptz not null,
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists api_keys (
      id bigserial primary key,
      account_id bigint not null,
      name text not null,
      key text not null,
      enabled boolean not null default true,
      status text not null default 'unknown',
      last_request_log_id bigint,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create index if not exists api_keys_account_id_id_idx
      on api_keys (account_id, id desc)
  `;
  await sql`
    create table if not exists models (
      id bigserial primary key,
      name text not null unique,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists upstream_models (
      id bigserial primary key,
      api_key_id bigint not null,
      model_id bigint,
      name text not null,
      enabled boolean not null default true,
      status text not null default 'unknown',
      endpoint_type text not null default 'openai_chat',
      last_sync_log_id bigint,
      last_request_log_id bigint,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create index if not exists upstream_models_api_key_id_id_idx
      on upstream_models (api_key_id, id desc)
  `;
  // endpoint_type 为后加列:对已存在的库用 add column if not exists 幂等补列。
  await sql`
    alter table upstream_models
    add column if not exists endpoint_type text not null default 'openai_chat'
  `;
  // status_data 为后加列:缓存站点健康检查时拉到的 new-api /api/status data 响应体。
  // perf_metrics 同为后加列:缓存同一次健康检查里拉到的 /api/perf-metrics/summary
  // 归一化结果(供上游模型行的迷你成功率柱状图)。
  await sql`
    alter table sites
    add column if not exists status_data jsonb,
    add column if not exists perf_metrics jsonb
  `;
  // user_data 为后加列:缓存账号数据同步时拉到的 new-api /api/user/self data 响应体。
  await sql`
    alter table accounts
    add column if not exists user_data jsonb
  `;
  // checkin_date/checkin_quota 为后加列:缓存今日签到记录(日期与收获额度)。
  await sql`
    alter table accounts
    add column if not exists checkin_date text,
    add column if not exists checkin_quota bigint
  `;
  await sql`
    create table if not exists request_logs (
      id bigserial primary key,
      occurred_at timestamptz not null default now(),
      status text not null,
      request_type text not null,
      http_status integer,
      prompt_tokens integer,
      completion_tokens integer,
      total_tokens integer,
      latency_ms integer,
      request_ip text,
      request_path text not null,
      request_key text,
      request_model text,
      upstream_url text,
      upstream_key text,
      upstream_model text,
      upstream_model_id bigint,
      error_message text,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists system_task_logs (
      id bigserial primary key,
      task_type text not null,
      status text not null,
      site_id bigint,
      account_id bigint,
      api_key_id bigint,
      upstream_model_id bigint,
      message text,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists system_settings (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    )
  `;
  // 修复历史脏数据(幂等):`sites.status_data` / `accounts.user_data` 曾被双重
  // 编码成 jsonb 字符串(详见 repairJsonCache),导致 `status_data->>'checkin_enabled'`
  // 恒为 NULL、账号签到按钮的「未开放」门禁永远不生效。这里就地还原成对象。
  try {
    const brokenSites = await sql<{ id: number; data: unknown }[]>`
      select id, status_data as data from sites
      where status_data is not null
        and jsonb_typeof(status_data) in ('string', 'array')
    `;
    for (const row of brokenSites) {
      const fixed = repairJsonCache(row.data);
      if (!fixed) continue;
      await sql`
        update sites
        set status_data = ${JSON.stringify(fixed)}::text::jsonb
        where id = ${row.id}
      `;
    }
    const brokenAccounts = await sql<{ id: number; data: unknown }[]>`
      select id, user_data as data from accounts
      where user_data is not null
        and jsonb_typeof(user_data) in ('string', 'array')
    `;
    for (const row of brokenAccounts) {
      const fixed = repairJsonCache(row.data);
      if (!fixed) continue;
      await sql`
        update accounts
        set user_data = ${JSON.stringify(fixed)}::text::jsonb
        where id = ${row.id}
      `;
    }
  } catch (error) {
    console.warn("[init] 修复双重编码的 jsonb 缓存失败:", error);
  }
}
