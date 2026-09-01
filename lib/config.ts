// 注意:cron_* 表达式由 Deno.cron 调度,时间一律按 UTC 解释(Deno.cron 不支持时区参数);
// day-of-week 使用 1-7(SUN-SAT)。修改 cron 设置后需重启服务才会生效。
export const defaultSettings = {
  proxy_auth_keys: "",
  request_log_retention_days: "30",
  request_log_flush_interval_minutes: "0",
  upstream_header_timeout_seconds: "60",
  channel_retry_count: "0",
  browser_checkin_enabled: "true",
  browser_checkin_timeout_seconds: "120",
  cron_account_checkin: "0 0,8,16 * * *",
  cron_account_quota_sync: "10 0,8,16 * * *",
  cron_site_health_check: "0 * * * *",
  cron_model_sync: "0 12 * * *",
  cron_request_log_cleanup: "30 3 * * *",
} as const;
