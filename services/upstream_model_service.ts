import { getSql } from "../db/client.ts";
import { type PageParams, pageResult } from "../lib/pagination.ts";
import { type EndpointType, endpointTypes } from "../types/enums.ts";
import {
  buildRowPerf,
  type RowPerf,
  type SitePerfCache,
} from "./perf_metrics_service.ts";

/**
 * @param withPerf 为 true 时附带每行的 `perf`(站点 perf_metrics 快照折叠出的
 *   迷你柱状图数据)。只有上游管理页需要;ModelsApp 的全量拉取不带,省流量。
 */
export async function listUpstreamModels(
  params: PageParams,
  options: { withPerf?: boolean } = {},
) {
  const sql = getSql();
  const values: Array<number | string> = [];
  const where: string[] = [];
  if (params.siteId !== undefined) {
    values.push(params.siteId);
    where.push(`accounts.site_id = $${values.length}`);
  }
  if (params.accountId !== undefined) {
    values.push(params.accountId);
    where.push(`api_keys.account_id = $${values.length}`);
  }
  if (params.apiKeyId !== undefined) {
    values.push(params.apiKeyId);
    where.push(`upstream_models.api_key_id = $${values.length}`);
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
  const fromSql = `
    from upstream_models
    join api_keys on api_keys.id = upstream_models.api_key_id
    join accounts on accounts.id = api_keys.account_id
    join sites on sites.id = accounts.site_id
    left join models on models.id = upstream_models.model_id
  `;
  const countRows = await sql.unsafe<{ count: number }[]>(
    `select count(distinct upstream_models.id)::int as count ${fromSql} ${whereSql}`,
    values,
  );
  const pageValues = [...values, params.pageSize, params.offset];
  const items = await sql.unsafe<Record<string, unknown>[]>(
    `select upstream_models.*, sites.id as site_id ${fromSql} ${whereSql}
     order by upstream_models.enabled desc, lower(upstream_models.name) asc, upstream_models.id desc
     limit $${values.length + 1} offset $${values.length + 2}`,
    pageValues,
  );
  if (!options.withPerf) {
    const plain = items.map((row) => {
      const { site_id: _siteId, ...rest } = row;
      return rest;
    });
    return pageResult(plain, params, Number(countRows[0]?.count ?? 0));
  }
  // 每行的 perf 来自所属站点的 perf_metrics 快照;同一页里站点会重复出现,按站点
  // 去重只取一次(jsonb 负载可能不小,不在行里重复传输/解析)。
  const siteIds = [...new Set(items.map((row) => Number(row.site_id)))];
  const perfCaches = new Map<number, SitePerfCache | null>();
  if (siteIds.length) {
    const cacheRows = await sql<{ id: number; perf_metrics: unknown }[]>`
      select id, perf_metrics from sites where id in ${sql(siteIds)}
    `;
    for (const row of cacheRows) {
      // postgres 驱动把 bigint 以字符串返回(全仓 *_id 都是这个约定),这里统一
      // 归一化成 number 再做键,避免与行里的 Number(site_id) 对不上。
      perfCaches.set(
        Number(row.id),
        (row.perf_metrics ?? null) as SitePerfCache | null,
      );
    }
  }
  const rows = items.map((row) => {
    const { site_id: siteId, ...rest } = row;
    return {
      ...rest,
      perf: buildRowPerf(
        perfCaches.get(Number(siteId)) ?? null,
        String(row.name),
      ) satisfies RowPerf,
    };
  });
  return pageResult(rows, params, Number(countRows[0]?.count ?? 0));
}

export async function updateUpstreamModel(
  id: number,
  input: { modelId?: number | null; enabled?: boolean; endpointType?: string },
) {
  const sql = getSql();
  const current = await sql<
    { model_id: number | null; enabled: boolean; endpoint_type: EndpointType }[]
  >`
    select model_id, enabled, endpoint_type from upstream_models where id = ${id}
  `;
  if (!current[0]) return null;
  // 注意:用 "in" 判断而非 ??,以支持显式传 modelId:null 解除映射。
  const modelId = "modelId" in input
    ? (input.modelId ?? null)
    : current[0].model_id;
  const enabled = input.enabled ?? current[0].enabled;
  // 只接受合法端点枚举值;非法/缺省时保持原值。
  const endpointType: EndpointType = typeof input.endpointType === "string" &&
      (endpointTypes as readonly string[]).includes(input.endpointType)
    ? input.endpointType as EndpointType
    : current[0].endpoint_type;
  await sql`
    update upstream_models
    set model_id = ${modelId}, enabled = ${enabled},
        endpoint_type = ${endpointType}, updated_at = now()
    where id = ${id}
  `;
  return { id, modelId, enabled, endpointType };
}
