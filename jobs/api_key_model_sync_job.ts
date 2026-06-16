import { getSql } from "../db/client.ts";
import { syncApiKeyModels } from "../services/api_key_service.ts";
import { runForIds } from "./runner.ts";

/** 对所有启用的 API Key 同步上游模型(仅同步已有 Key,不拉取新 Key)。 */
export async function runApiKeyModelSyncJob() {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    select id from api_keys where enabled = true order by id
  `;
  return await runForIds(rows.map((row) => row.id), syncApiKeyModels);
}
