import { getSql } from "../db/client.ts";
import { healthCheckSite } from "../services/site_service.ts";
import { runForIds } from "./runner.ts";

/** 对所有启用站点做健康检查(含 status=down 的,以便恢复后重新标记 healthy)。 */
export async function runSiteHealthCheckJob() {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    select id from sites where enabled = true order by id
  `;
  return await runForIds(rows.map((row) => row.id), healthCheckSite);
}
