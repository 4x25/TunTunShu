import { define } from "../../utils.ts";
import { json } from "../../lib/response.ts";
import { requireAdmin } from "../../lib/auth.ts";
import { getSql } from "../../db/client.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const sql = getSql();

    // 资源计数 + 各状态分布(单查询聚合)
    const [siteAgg] = await sql<
      { total: number; healthy: number; down: number }[]
    >`select count(*)::int total,
        count(*) filter (where status='healthy')::int healthy,
        count(*) filter (where status='down')::int down
      from sites`;
    const [accAgg] = await sql<
      { total: number; healthy: number; invalid: number; quota_empty: number }[]
    >`select count(*)::int total,
        count(*) filter (where status='healthy')::int healthy,
        count(*) filter (where status='invalid')::int invalid,
        count(*) filter (where status='quota_empty')::int quota_empty
      from accounts`;
    const [keyAgg] = await sql<
      { total: number; healthy: number; invalid: number }[]
    >`select count(*)::int total,
        count(*) filter (where status='healthy')::int healthy,
        count(*) filter (where status='invalid')::int invalid
      from api_keys`;
    const [modelAgg] = await sql<{ total: number }[]>`
      select count(*)::int total from models`;
    const [umAgg] = await sql<{ total: number }[]>`
      select count(*)::int total from upstream_models`;
    const [routable] = await sql<{ count: number }[]>`
      select count(distinct models.id)::int as count
      from models
      join upstream_models on upstream_models.model_id = models.id
      join api_keys on api_keys.id = upstream_models.api_key_id
      join accounts on accounts.id = api_keys.account_id
      join sites on sites.id = accounts.site_id
      where models.enabled = true and upstream_models.enabled = true
        and upstream_models.status <> 'invalid'
        and api_keys.enabled = true and api_keys.status <> 'invalid'
        and accounts.enabled = true and accounts.status <> 'invalid'
        and sites.enabled = true and sites.status <> 'down'`;

    // 今日请求统计(按服务器本地日界)
    const [today] = await sql<
      {
        total: number;
        success: number;
        failed: number;
        tokens: number;
        p50: number;
      }[]
    >`
      select
        count(*)::int total,
        count(*) filter (where status='success')::int success,
        count(*) filter (where status='failed')::int failed,
        coalesce(sum(total_tokens),0)::bigint tokens,
        coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)::int p50
      from request_logs
      where created_at >= date_trunc('day', now())`;

    // 近 24 小时逐小时成功/失败(用于趋势图)
    const trend = await sql<
      { label: string; success: number; fail: number }[]
    >`
      select to_char(h, 'HH24:00') as label,
        coalesce(sum(case when rl.status='success' then 1 else 0 end),0)::int as success,
        coalesce(sum(case when rl.status='failed' then 1 else 0 end),0)::int as fail
      from generate_series(
        date_trunc('hour', now()) - interval '23 hours',
        date_trunc('hour', now()),
        interval '1 hour'
      ) as g(h)
      left join request_logs rl on date_trunc('hour', rl.created_at) = g.h
      group by h order by h`;

    // 站点概览 + 最近系统任务
    const sites = await sql`
      select id, name, origin, status, enabled from sites order by id desc`;
    const recentTasks = await sql`
      select task_type, status, message, created_at
      from system_task_logs order by id desc limit 6`;

    const successRate = today.total > 0
      ? Number((today.success / today.total * 100).toFixed(1))
      : 100;

    return json({
      sites: {
        total: siteAgg.total,
        healthy: siteAgg.healthy,
        down: siteAgg.down,
      },
      accounts: {
        total: accAgg.total,
        healthy: accAgg.healthy,
        invalid: accAgg.invalid,
        quotaEmpty: accAgg.quota_empty,
      },
      apiKeys: {
        total: keyAgg.total,
        healthy: keyAgg.healthy,
        invalid: keyAgg.invalid,
      },
      models: {
        total: modelAgg.total,
        upstream: umAgg.total,
        routable: routable.count,
      },
      today: {
        total: today.total,
        success: today.success,
        failed: today.failed,
        successRate,
        tokens: Number(today.tokens),
        p50LatencyMs: today.p50,
      },
      trend,
      siteList: sites,
      recentTasks,
    });
  },
});
