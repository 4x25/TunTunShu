import { getSql } from "../db/client.ts";

export async function listRequestLogs() {
  const sql = getSql();
  return await sql`select * from request_logs order by id desc limit 200`;
}

export async function clearRequestLogs() {
  const sql = getSql();
  await sql`delete from request_logs`;
}
