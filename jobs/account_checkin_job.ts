import { getSql } from "../db/client.ts";
import { checkinAccount } from "../services/account_service.ts";
import { runForIds } from "./runner.ts";

export function classifyAccountCheckinResult(
  result: unknown,
): "success" | "failed" | "skipped" {
  const value = result as {
    ok?: boolean;
    skipped?: boolean;
    checkinStatus?: string;
    automation?: { attempted?: boolean; code?: string };
  } | null;
  if (value?.skipped) return "skipped";
  if (value?.checkinStatus === "manual_required") {
    if (!value.automation) return "skipped";
    return !value.automation.attempted &&
        (!value.automation.code ||
          ["disabled", "busy"].includes(value.automation.code))
      ? "skipped"
      : "failed";
  }
  return value?.ok ? "success" : "failed";
}

/**
 * 对所有启用账号执行签到。未启用/繁忙而未启动浏览器的验证计为 skipped；
 * 浏览器已经启动但失败则计为 failed。
 */
export async function runAccountCheckinJob() {
  const sql = getSql();
  const rows = await sql<{ id: number }[]>`
    select accounts.id
    from accounts
    join sites on sites.id = accounts.site_id
    where accounts.enabled = true
      and coalesce((sites.status_data->>'checkin_enabled')::boolean, true)
    order by accounts.id
  `;
  return await runForIds(
    rows.map((row) => row.id),
    checkinAccount,
    classifyAccountCheckinResult,
  );
}
