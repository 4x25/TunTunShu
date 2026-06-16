import { getSql } from "../db/client.ts";

export async function createModel(input: { name: string }) {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    insert into models (name)
    values (${input.name})
    returning id
  `;
  return rows[0]?.id ?? null;
}

export async function listModels() {
  const sql = getSql();
  return await sql`
    select
      models.id,
      models.name,
      models.enabled,
      models.created_at,
      models.updated_at,
      count(upstream_models.id)::int as upstream_model_count,
      count(upstream_models.id) filter (where upstream_models.status = 'healthy' and upstream_models.enabled = true)::int as healthy_upstream_model_count
    from models
    left join upstream_models on upstream_models.model_id = models.id
    group by models.id
    order by models.id desc
  `;
}

export async function updateModel(
  id: number,
  input: { name?: string; enabled?: boolean },
) {
  const sql = getSql();
  const current = await sql<
    { name: string; enabled: boolean }[]
  >`select name, enabled from models where id = ${id}`;
  if (!current[0]) return null;
  const name = input.name ?? current[0].name;
  const enabled = input.enabled ?? current[0].enabled;
  await sql`update models set name = ${name}, enabled = ${enabled}, updated_at = now() where id = ${id}`;
  return { id, name, enabled };
}

export async function deleteModel(id: number) {
  const sql = getSql();
  await sql`update upstream_models set model_id = null, updated_at = now() where model_id = ${id}`;
  await sql`delete from models where id = ${id}`;
}
