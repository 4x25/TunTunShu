export interface Site {
  id: string;
  name: string;
  origin: string;
  enabled: boolean;
  status: string;
  remark: string | null;
}

export interface Account {
  id: string;
  site_id: string;
  name: string;
  user_id: string;
  access_token: string;
  enabled: boolean;
  status: string;
  quota: string;
  used_quota: string;
  checkin_status: string;
}

export interface ApiKey {
  id: string;
  account_id: string;
  name: string;
  key: string;
  enabled: boolean;
  status: string;
}

export interface UpstreamModel {
  id: string;
  api_key_id: string;
  model_id: string | null;
  name: string;
  enabled: boolean;
  status: string;
  endpoint_type: string;
}

export interface Model {
  id: string;
  name: string;
}

export type TestKind = "chat" | "vision" | "tool";

export interface TestResult {
  endpointType: string;
  kind: string;
  prompt: string;
  imageLabel?: string;
  reply: string;
  toolCalls: { name: string; input: unknown }[];
  pass: boolean;
  reason: string;
  latencyMs: number;
  httpStatus?: number;
  error?: string;
}

export type TestRunState =
  | { status: "loading" }
  | { status: "done"; result: TestResult };

export type TestRunStates = Record<
  string,
  Partial<Record<TestKind, TestRunState>>
>;

export interface ListPage<T> {
  items: T[];
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
}

export type CreateType = "site" | "account" | "apikey";

export type ModalSpec =
  | { mode: "create"; type: CreateType }
  | { mode: "edit"; type: "site" | "account"; id: string };

export interface Selection {
  site: string | null;
  account: string | null;
  key: string | null;
}

export interface Flash {
  text: string;
  ok: boolean;
}

export type RefreshScope =
  | "all"
  | "site"
  | "siteOnly"
  | "account"
  | "key"
  | "um"
  | "models";
