import postgres from "postgres";
import { getDatabaseDsn } from "../lib/env.ts";

let sqlInstance: ReturnType<typeof postgres> | null = null;

export function getSql() {
  if (!sqlInstance) {
    sqlInstance = postgres(getDatabaseDsn(), {
      max: 1,
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
