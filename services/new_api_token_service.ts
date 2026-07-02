import {
  NewApiAdapter,
  type NewApiUserAuth,
} from "../adapters/new_api_adapter.ts";

const adapter = new NewApiAdapter();
const TOKEN_PAGE_SIZE = 100;
const TOKEN_STATUS_ENABLED = 1;
const TOKEN_STATUS_DISABLED = 2;

export interface UpstreamTokenItem {
  id?: number;
  key?: string;
  name?: string;
  status?: number;
}

export interface TokenListPayload {
  success?: boolean;
  message?: string;
  data?: {
    items?: UpstreamTokenItem[];
    total?: number;
    page_size?: number;
  };
}

export function upstreamTokenEnabled(
  status: unknown,
  fallback: boolean,
): boolean {
  return typeof status === "number"
    ? status === TOKEN_STATUS_ENABLED
    : fallback;
}

function maskNewApiTokenKey(key: string): string {
  if (key === "") return "";
  if (key.length <= 4) return "*".repeat(key.length);
  if (key.length <= 8) return `${key.slice(0, 2)}****${key.slice(-2)}`;
  return `${key.slice(0, 4)}**********${key.slice(-4)}`;
}

export async function listAllAccountTokens(auth: NewApiUserAuth) {
  const items: UpstreamTokenItem[] = [];
  let page = 1;
  let lastData: TokenListPayload = {};

  while (true) {
    const response = await adapter.listTokens(auth, page, TOKEN_PAGE_SIZE);
    lastData = await response.json().catch(() => ({})) as TokenListPayload;
    const ok = response.ok && lastData.success === true;
    const pageItems = lastData.data?.items;
    if (!ok || !Array.isArray(pageItems)) {
      return { ok: false, items, data: lastData };
    }

    items.push(...pageItems);
    const total = lastData.data?.total;
    const pageSize = lastData.data?.page_size || TOKEN_PAGE_SIZE;
    if (pageItems.length === 0) break;
    if (
      typeof total === "number" && Number.isFinite(total)
        ? items.length >= total
        : pageItems.length < pageSize
    ) {
      break;
    }
    page += 1;
  }

  return { ok: true, items, data: lastData };
}

export async function findUpstreamTokenIdByKey(
  auth: NewApiUserAuth,
  key: string,
) {
  const tokenList = await listAllAccountTokens(auth);
  if (!tokenList.ok) {
    return { ok: false, tokenId: null, data: tokenList.data };
  }

  let incomplete = false;
  const maskedKey = maskNewApiTokenKey(key);
  const maskedMatches: number[] = [];

  for (const item of tokenList.items) {
    if (!item.id) {
      incomplete = true;
      continue;
    }
    if (item.key === key) {
      return { ok: true, tokenId: item.id, data: { match: "listed_key" } };
    }
    if (item.key === maskedKey) {
      maskedMatches.push(item.id);
    }

    const response = await adapter.getTokenKey(auth, item.id);
    const data = await response.json().catch(() => ({})) as {
      data?: { key?: string };
    };
    if (!response.ok || !data.data?.key) {
      incomplete = true;
      continue;
    }
    if (data.data.key === key) {
      return { ok: true, tokenId: item.id, data };
    }
  }

  if (incomplete && maskedMatches.length > 0) {
    return {
      ok: false,
      tokenId: null,
      data: { error: "token_lookup_incomplete" },
    };
  }

  if (maskedMatches.length === 1) {
    return {
      ok: true,
      tokenId: maskedMatches[0],
      data: { match: "masked_key" },
    };
  }
  if (maskedMatches.length > 1) {
    return {
      ok: false,
      tokenId: null,
      data: { error: "ambiguous_masked_key" },
    };
  }

  return {
    ok: false,
    tokenId: null,
    data: { error: incomplete ? "token_lookup_incomplete" : "token_not_found" },
  };
}

export async function setUpstreamTokenEnabled(
  auth: NewApiUserAuth,
  tokenId: number,
  enabled: boolean,
) {
  const response = await adapter.updateTokenStatus(
    auth,
    tokenId,
    enabled ? TOKEN_STATUS_ENABLED : TOKEN_STATUS_DISABLED,
  );
  const data = await response.json().catch(() => ({})) as {
    success?: boolean;
    message?: string;
  };
  return { ok: response.ok && data.success === true, data };
}
