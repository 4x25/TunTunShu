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
      last_sync_log_id bigint,
      last_request_log_id bigint,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
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
