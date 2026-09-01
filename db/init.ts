import { getSql } from "./client.ts";

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
}
