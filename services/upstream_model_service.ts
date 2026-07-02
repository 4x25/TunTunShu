import { getSql } from "../db/client.ts";
import { type PageParams, pageResult } from "../lib/pagination.ts";
import { type EndpointType, endpointTypes } from "../types/enums.ts";

export async function listUpstreamModels(params: PageParams) {
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
  if (params.q) {
    values.push(`%${params.q}%`);
    where.push(
      `(upstream_models.name ilike $${values.length} or models.name ilike $${values.length})`,
    );
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const fromSql = `
    from upstream_models
    join api_keys on api_keys.id = upstream_models.api_key_id
    join accounts on accounts.id = api_keys.account_id
    left join models on models.id = upstream_models.model_id
  `;
  const countRows = await sql.unsafe<{ count: number }[]>(
    `select count(*)::int as count ${fromSql} ${whereSql}`,
    values,
  );
  const pageValues = [...values, params.pageSize, params.offset];
  const items = await sql.unsafe(
    `select upstream_models.* ${fromSql} ${whereSql}
     order by upstream_models.id desc
     limit $${values.length + 1} offset $${values.length + 2}`,
    pageValues,
  );
  return pageResult(items, params, Number(countRows[0]?.count ?? 0));
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
