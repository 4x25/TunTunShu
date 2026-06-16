import type {
  AccountStatus,
  ApiKeyStatus,
  CheckinStatus,
  RequestLogStatus,
  RequestType,
  SiteStatus,
  SystemTaskStatus,
  SystemTaskType,
  UpstreamModelStatus,
} from "./enums.ts";

export interface Site {
  id: number;
  name: string;
  origin: string;
  enabled: boolean;
  status: SiteStatus;
  lastHealthCheckLogId: number | null;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  id: number;
  siteId: number;
  name: string;
  userId: string;
  accessToken: string;
  enabled: boolean;
  status: AccountStatus;
  quota: number;
  usedQuota: number;
  checkinStatus: CheckinStatus;
  lastCheckinLogId: number | null;
  lastQuotaSyncLogId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: number;
  accountId: number;
  name: string;
  key: string;
  enabled: boolean;
  status: ApiKeyStatus;
  lastRequestLogId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Model {
  id: number;
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpstreamModel {
  id: number;
  apiKeyId: number;
  modelId: number | null;
  name: string;
  enabled: boolean;
  status: UpstreamModelStatus;
  lastSyncLogId: number | null;
  lastRequestLogId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestLog {
  id: number;
  occurredAt: Date;
  status: RequestLogStatus;
  requestType: RequestType;
  httpStatus: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  requestIp: string | null;
  requestPath: string;
  requestKey: string | null;
  requestModel: string | null;
  upstreamUrl: string | null;
  upstreamKey: string | null;
  upstreamModel: string | null;
  upstreamModelId: number | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface SystemTaskLog {
  id: number;
  taskType: SystemTaskType;
  status: SystemTaskStatus;
  siteId: number | null;
  accountId: number | null;
  apiKeyId: number | null;
  upstreamModelId: number | null;
  message: string | null;
  createdAt: Date;
}

export interface SystemSetting {
  key: string;
  value: string;
  updatedAt: Date;
}
