import { define } from "../../utils.ts";
import { json } from "../../lib/response.ts";
import { requireAdmin } from "../../lib/auth.ts";
import { getSql } from "../../db/client.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const unauthorized = requireAdmin(ctx.req);
    if (unauthorized) return unauthorized;
    const sql = getSql();
    const sites = await sql`select count(*)::int as count from sites`;
    const accounts = await sql`select count(*)::int as count from accounts`;
    const apiKeys = await sql`select count(*)::int as count from api_keys`;
    const models = await sql`select count(*)::int as count from models`;
    const upstreamModels =
      await sql`select count(*)::int as count from upstream_models`;
    const requestLogs =
      await sql`select count(*)::int as count from request_logs`;
    const healthySites =
      await sql`select count(*)::int as count from sites where status = 'healthy'`;
    const downSites =
      await sql`select count(*)::int as count from sites where status = 'down'`;
    const healthyAccounts =
      await sql`select count(*)::int as count from accounts where status = 'healthy'`;
    const invalidAccounts =
      await sql`select count(*)::int as count from accounts where status = 'invalid'`;
    const quotaEmptyAccounts =
      await sql`select count(*)::int as count from accounts where status = 'quota_empty'`;
    const healthyApiKeys =
      await sql`select count(*)::int as count from api_keys where status = 'healthy'`;
    const invalidApiKeys =
      await sql`select count(*)::int as count from api_keys where status = 'invalid'`;
    const routableModels = await sql`
      select count(distinct models.id)::int as count
      from models
      join upstream_models on upstream_models.model_id = models.id
      join api_keys on api_keys.id = upstream_models.api_key_id
      join accounts on accounts.id = api_keys.account_id
      join sites on sites.id = accounts.site_id
      where models.enabled = true
        and upstream_models.enabled = true
        and upstream_models.status <> 'invalid'
        and api_keys.enabled = true
        and api_keys.status <> 'invalid'
        and accounts.enabled = true
        and accounts.status <> 'invalid'
        and sites.enabled = true
        and sites.status <> 'down'
    `;
    return json({
      sites: {
        total: sites[0].count,
        healthy: healthySites[0].count,
        down: downSites[0].count,
      },
      accounts: {
        total: accounts[0].count,
        healthy: healthyAccounts[0].count,
        invalid: invalidAccounts[0].count,
        quotaEmpty: quotaEmptyAccounts[0].count,
      },
      apiKeys: {
        total: apiKeys[0].count,
        healthy: healthyApiKeys[0].count,
        invalid: invalidApiKeys[0].count,
      },
      models: {
        total: models[0].count,
        upstream: upstreamModels[0].count,
        routable: routableModels[0].count,
      },
      requestsToday: { total: requestLogs[0].count, success: 0, failed: 0 },
    });
  },
});
