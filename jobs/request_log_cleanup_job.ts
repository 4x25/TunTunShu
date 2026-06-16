import { getSettings } from "../services/settings_service.ts";
import { deleteRequestLogsOlderThan } from "../services/request_log_service.ts";

/** 按 request_log_retention_days 删除过期请求日志。 */
export async function runRequestLogCleanupJob() {
  const settings = await getSettings();
  const days = Number(settings.request_log_retention_days);
  const retentionDays = Number.isFinite(days) && days > 0 ? days : 30;
  const deleted = await deleteRequestLogsOlderThan(retentionDays);
  return { retentionDays, deleted };
}
