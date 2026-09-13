import { getSql } from "../db/client.ts";
import { syncAccount } from "../services/account_service.ts";
import { runForIds } from "./runner.ts";

/**
 * 对所有启用账号做数据同步(cron 名/路由/设置键沿用 account_quota_sync),
 * 每个账号执行 syncAccount(账号数据 ‖ 拉 Key,仅新增 Key 顺带拉模型)。
 */
export async function runAccountDataSyncJob() {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    select id from accounts where enabled = true order by id
  `;
  return await runForIds(rows.map((row) => row.id), syncAccount);
}
