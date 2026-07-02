export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 50;

export type ParentFilterKey = "siteId" | "accountId" | "apiKeyId";
export type PathSearchKey = "siteQ" | "accountQ" | "apiKeyQ" | "modelQ";

export interface PageParams {
  pageSize: number;
  pageIndex: number;
  offset: number;
  q: string;
  siteQ: string;
  accountQ: string;
  apiKeyQ: string;
  modelQ: string;
  siteId?: number;
  accountId?: number;
  apiKeyId?: number;
}

export interface PageResult<T> {
  items: T[];
  pageSize: number;
  pageIndex: number;
  totalCount: number;
}

export class PageParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageParamError";
  }
}

function positiveInt(
  params: URLSearchParams,
  name: string,
): number | undefined {
  const raw = params.get(name);
  if (raw == null || raw === "") return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new PageParamError(`${name} must be a positive integer`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new PageParamError(`${name} must be a positive integer`);
  }
  return n;
}

export function parsePageParams(
  request: Request,
  filters: readonly ParentFilterKey[] = [],
  qAlias?: PathSearchKey,
): PageParams {
  const params = new URL(request.url).searchParams;
  const requestedSize = positiveInt(params, "pageSize") ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requestedSize, MAX_PAGE_SIZE);
  const pageIndex = positiveInt(params, "pageIndex") ?? 1;
  const q = (params.get("q") ?? "").trim();
  const result: PageParams = {
    pageSize,
    pageIndex,
    offset: (pageIndex - 1) * pageSize,
    q,
    siteQ: (params.get("siteQ") ?? "").trim(),
    accountQ: (params.get("accountQ") ?? "").trim(),
    apiKeyQ: (params.get("apiKeyQ") ?? "").trim(),
    modelQ: (params.get("modelQ") ?? "").trim(),
  };
  if (q && qAlias && !result[qAlias]) result[qAlias] = q;
  for (const key of filters) {
    const value = positiveInt(params, key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function pageResult<T>(
  items: T[],
  params: PageParams,
  totalCount: number,
): PageResult<T> {
  return {
    items,
    pageSize: params.pageSize,
    pageIndex: params.pageIndex,
    totalCount,
  };
}
