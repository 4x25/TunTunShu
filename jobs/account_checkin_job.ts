import { getSql } from "../db/client.ts";
import { checkinAccount } from "../services/account_service.ts";
import { runForIds } from "./runner.ts";

/** 对所有启用账号执行签到。manual_required(需人机验证)计为 skipped。 */
export async function runAccountCheckinJob() {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    select id from accounts where enabled = true order by id
  `;
  return await runForIds(
    rows.map((row) => row.id),
    checkinAccount,
    (result) => {
      const r = result as { ok?: boolean; checkinStatus?: string } | null;
      if (r?.checkinStatus === "manual_required") return "skipped";
      return r?.ok ? "success" : "failed";
    },
  );
}
