export const siteStatuses = ["unknown", "healthy", "down"] as const;
export type SiteStatus = typeof siteStatuses[number];

export const accountStatuses = [
  "unknown",
  "healthy",
  "invalid",
  "quota_empty",
] as const;
export type AccountStatus = typeof accountStatuses[number];

export const checkinStatuses = [
  "unknown",
  "checked",
  "unchecked",
  "manual_required",
  "failed",
] as const;
export type CheckinStatus = typeof checkinStatuses[number];

export const apiKeyStatuses = [
  "unknown",
  "healthy",
  "invalid",
  "quota_empty",
] as const;
export type ApiKeyStatus = typeof apiKeyStatuses[number];

export const upstreamModelStatuses = ["unknown", "healthy", "invalid"] as const;
export type UpstreamModelStatus = typeof upstreamModelStatuses[number];

// 上游模型适配的端点格式(仅用于测试功能,不影响线上代理路由)。
export const endpointTypes = [
  "openai_chat",
  "openai_responses",
  "claude_messages",
  "gemini_generate",
] as const;
export type EndpointType = typeof endpointTypes[number];

export const requestLogStatuses = ["success", "failed"] as const;
export type RequestLogStatus = typeof requestLogStatuses[number];

export const requestTypes = ["final", "retry"] as const;
export type RequestType = typeof requestTypes[number];

export const systemTaskTypes = [
  "site_health_check",
  "account_checkin",
  "account_quota_sync",
  "account_api_key_sync",
  "api_key_model_sync",
  "request_log_flush",
  "request_log_cleanup",
] as const;
export type SystemTaskType = typeof systemTaskTypes[number];

export const systemTaskStatuses = ["success", "failed", "skipped"] as const;
export type SystemTaskStatus = typeof systemTaskStatuses[number];
