import { getSql } from "../db/client.ts";
import { syncAccountQuota } from "../services/account_service.ts";
import { runForIds } from "./runner.ts";

/** 对所有启用账号同步额度。 */
export async function runAccountQuotaSyncJob() {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    select id from accounts where enabled = true order by id
  `;
  return await runForIds(rows.map((row) => row.id), syncAccountQuota);
}
