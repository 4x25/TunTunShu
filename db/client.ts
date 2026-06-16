import postgres from "postgres";
import { getDatabaseDsn } from "../lib/env.ts";

let sqlInstance: ReturnType<typeof postgres> | null = null;

export function getSql() {
  if (!sqlInstance) {
    sqlInstance = postgres(getDatabaseDsn(), {
      // cron 后台任务与 HTTP 请求共用此单例连接池,留出多个连接避免相互阻塞
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sqlInstance;
}

export async function closeDatabase() {
  if (sqlInstance) {
    await sqlInstance.end({ timeout: 5 });
    sqlInstance = null;
  }
}
