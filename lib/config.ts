export const defaultSettings = {
  proxy_auth_keys: "",
  request_log_retention_days: "30",
  request_log_flush_interval_minutes: "0",
  upstream_header_timeout_seconds: "60",
  channel_retry_count: "0",
  cron_account_checkin: "0 0,8,16 * * *",
  cron_account_quota_sync: "10 0,8,16 * * *",
  cron_site_health_check: "0 * * * *",
  cron_model_sync: "0 12 * * *",
} as const;
