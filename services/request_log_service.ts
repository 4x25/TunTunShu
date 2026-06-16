import { getSql } from "../db/client.ts";

export async function listRequestLogs() {
  const sql = getSql();
  return await sql`select * from request_logs order by id desc limit 200`;
}

export async function clearRequestLogs() {
  const sql = getSql();
  await sql`delete from request_logs`;
}

/** 删除早于 N 天的请求日志,返回删除条数。 */
export async function deleteRequestLogsOlderThan(
  days: number,
): Promise<number> {
  const sql = getSql();
  const result = await sql`
    delete from request_logs
    where created_at < now() - (${days}::int * interval '1 day')
  `;
  return result.count ?? 0;
}
