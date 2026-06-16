import { getSql } from "../db/client.ts";

export async function createSystemTaskLog(input: {
  taskType: string;
  status: string;
  siteId?: number | null;
  accountId?: number | null;
  apiKeyId?: number | null;
  upstreamModelId?: number | null;
  message?: string | null;
}) {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    insert into system_task_logs (
      task_type,
      status,
      site_id,
      account_id,
      api_key_id,
      upstream_model_id,
      message
    ) values (
      ${input.taskType},
      ${input.status},
      ${input.siteId ?? null},
      ${input.accountId ?? null},
      ${input.apiKeyId ?? null},
      ${input.upstreamModelId ?? null},
      ${input.message ?? null}
    ) returning id
  `;
  return rows[0]?.id ?? null;
}

export async function listSystemTaskLogs() {
  const sql = getSql();
  return await sql`
    select * from system_task_logs order by id desc limit 200
  `;
}
