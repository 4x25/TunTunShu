import { getSql } from "../db/client.ts";

export async function listUpstreamModels() {
  const sql = getSql();
  return await sql`select * from upstream_models order by id desc`;
}

export async function updateUpstreamModel(
  id: number,
  input: { modelId?: number | null; enabled?: boolean },
) {
  const sql = getSql();
  const current = await sql<{ model_id: number | null; enabled: boolean }[]>`
    select model_id, enabled from upstream_models where id = ${id}
  `;
  if (!current[0]) return null;
  const modelId = input.modelId ?? current[0].model_id;
  const enabled = input.enabled ?? current[0].enabled;
  await sql`
    update upstream_models
    set model_id = ${modelId}, enabled = ${enabled}, updated_at = now()
    where id = ${id}
  `;
  return { id, modelId, enabled };
}
