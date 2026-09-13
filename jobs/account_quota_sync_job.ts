import { getSql } from "../db/client.ts";
import {
  syncAccountApiKeys,
  syncAccountData,
} from "../services/account_service.ts";
import { runForIds } from "./runner.ts";

/**
 * 对所有启用账号做数据同步(cron 名/路由/设置键沿用 account_quota_sync):
 * - syncAccountData:额度/用户数据缓存/今日签到状态(写 accounts);
 * - syncAccountApiKeys:拉取上游 ApiKey(写 api_keys/upstream_models),
 *   默认仅对本轮新增 Key 顺带拉模型,存量 Key 的模型由 api_key_model_sync cron 负责。
 * 两者分写不同表,按 refreshAccount 同样的编排并发执行。
 */
async function runAccountSync(id: number) {
  const [data, keys] = await Promise.all([
    syncAccountData(id),
    syncAccountApiKeys(id),
  ]);
  return {
    ok: data?.ok === true && keys?.ok === true,
    data,
    keys,
  };
}

export async function runAccountDataSyncJob() {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    select id from accounts where enabled = true order by id
  `;
  return await runForIds(rows.map((row) => row.id), runAccountSync);
}
