import { getSql } from "../db/client.ts";
import { type EndpointType, endpointTypes } from "../types/enums.ts";

export async function listUpstreamModels() {
  const sql = getSql();
  return await sql`select * from upstream_models order by id desc`;
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
