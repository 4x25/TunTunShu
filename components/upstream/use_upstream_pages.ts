import { useEffect, useRef, useState } from "preact/hooks";
import { apiGet, apiPage, type PageResult } from "../admin_api.ts";
import { PAGE_SIZE } from "./constants.ts";
import { emptyPage, errorMessage, mergePage } from "./list_state.ts";
import type {
  Account,
  ApiKey,
  ListPage,
  Model,
  RefreshScope,
  Selection,
  Site,
  UpstreamModel,
} from "./types.ts";

type LoadMode = "replace" | "revalidate" | "append";
type PageParams = Record<string, string | number | null | undefined>;
type PageSetter<T> = (
  value: ListPage<T> | ((prev: ListPage<T>) => ListPage<T>),
) => void;

interface CachedPage<T> {
  items: T[];
  pageIndex: number;
  pageSize: number;
  totalCount: number;
}

const listCache = new Map<string, CachedPage<unknown>>();

function listKey(...parts: Array<string | number | null | undefined>): string {
  return JSON.stringify(parts.map((part) => part ?? ""));
}

function readCache<T>(key: string): CachedPage<T> | null {
  const cached = listCache.get(key) as CachedPage<T> | undefined;
  if (!cached) return null;
  return { ...cached, items: [...cached.items] };
}

function writeCache<T>(
  key: string,
  page: Pick<ListPage<T>, "items" | "pageIndex" | "pageSize" | "totalCount">,
) {
  listCache.set(key, {
    items: [...page.items],
    pageIndex: page.pageIndex,
    pageSize: page.pageSize,
    totalCount: page.totalCount,
  });
}

function pageFromCache<T>(cached: CachedPage<T>): ListPage<T> {
  return {
    items: [...cached.items],
    pageIndex: cached.pageIndex,
    pageSize: cached.pageSize,
    totalCount: cached.totalCount,
    loading: false,
    loadingMore: false,
    refreshing: true,
    error: null,
  };
}

async function fetchThroughPage<T>(
  path: string,
  params: PageParams,
  targetPageIndex: number,
): Promise<PageResult<T>> {
  const pages: PageResult<T>[] = [];
  const lastWanted = Math.max(1, targetPageIndex);
  for (let pageIndex = 1; pageIndex <= lastWanted; pageIndex += 1) {
    const page = await apiPage<T>(path, {
      ...params,
      pageIndex,
      pageSize: PAGE_SIZE,
    });
    pages.push(page);
    if (
      page.items.length === 0 ||
      page.pageIndex * page.pageSize >= page.totalCount
    ) break;
  }
  const last = pages[pages.length - 1];
  return {
    items: pages.flatMap((page) => page.items),
    pageIndex: last.pageIndex,
    pageSize: last.pageSize,
    totalCount: last.totalCount,
  };
}

async function loadCachedPage<T>(
  {
    state,
    setState,
    req,
    mode,
    key,
    path,
    params,
  }: {
    state: ListPage<T>;
    setState: PageSetter<T>;
    req: { current: number };
    mode: LoadMode;
    key: string;
    path: string;
    params: PageParams;
  },
) {
  const append = mode === "append";
  if (
    append &&
    (state.loading || state.loadingMore || state.refreshing ||
      state.items.length >= state.totalCount)
  ) return;

  const cached = append ? null : readCache<T>(key);
  const targetPageIndex = append ? state.pageIndex + 1 : Math.max(
    1,
    mode === "replace"
      ? cached?.pageIndex ?? 1
      : state.pageIndex || cached?.pageIndex || 1,
  );
  const version = ++req.current;

  setState((prev) => {
    if (append) {
      return {
        ...prev,
        loading: false,
        loadingMore: true,
        refreshing: false,
        error: null,
      };
    }
    if (mode === "replace" && cached) return pageFromCache(cached);
    if (mode === "revalidate" && prev.items.length === 0 && cached) {
      return pageFromCache(cached);
    }
    return {
      ...prev,
      items: mode === "replace" ? [] : prev.items,
      pageIndex: mode === "replace" ? 0 : prev.pageIndex,
      totalCount: mode === "replace" ? 0 : prev.totalCount,
      loading: mode === "replace" || prev.items.length === 0,
      loadingMore: false,
      refreshing: mode === "revalidate" && prev.items.length > 0,
      error: null,
    };
  });

  try {
    const page = append
      ? await apiPage<T>(path, {
        ...params,
        pageIndex: targetPageIndex,
        pageSize: PAGE_SIZE,
      })
      : await fetchThroughPage<T>(path, params, targetPageIndex);
    if (version !== req.current) return;
    setState((prev) => {
      const next = mergePage(prev, page, append);
      writeCache(key, next);
      return next;
    });
  } catch (error) {
    if (version !== req.current) return;
    setState((prev) => ({
      ...prev,
      loading: false,
      loadingMore: false,
      refreshing: false,
      error: errorMessage(error),
    }));
  }
}

export function useUpstreamPages(
  { sel, qSite, qAcc, qKey, qMod }: {
    sel: Selection;
    qSite: string;
    qAcc: string;
    qKey: string;
    qMod: string;
  },
) {
  const [sitePage, setSitePage] = useState<ListPage<Site>>(() => emptyPage());
  const [accountPage, setAccountPage] = useState<ListPage<Account>>(() =>
    emptyPage()
  );
  const [keyPage, setKeyPage] = useState<ListPage<ApiKey>>(() => emptyPage());
  const [umPage, setUmPage] = useState<ListPage<UpstreamModel>>(() =>
    emptyPage()
  );
  const [models, setModels] = useState<Model[]>([]);
  const [checkinMsg, setCheckinMsg] = useState<Record<string, string>>({});
  const siteReq = useRef(0);
  const accountReq = useRef(0);
  const keyReq = useRef(0);
  const umReq = useRef(0);
  const siteKey = listKey("sites", PAGE_SIZE, qSite, qAcc, qKey, qMod);
  const accountKey = listKey(
    "accounts",
    PAGE_SIZE,
    qSite,
    qAcc,
    qKey,
    qMod,
    sel.site,
  );
  const keyKey = listKey(
    "api-keys",
    PAGE_SIZE,
    qSite,
    qAcc,
    qKey,
    qMod,
    sel.site,
    sel.account,
  );
  const umKey = listKey(
    "upstream-models",
    PAGE_SIZE,
    qSite,
    qAcc,
    qKey,
    qMod,
    sel.site,
    sel.account,
    sel.key,
  );

  async function loadModels() {
    setModels(await apiGet<Model[]>("/models"));
  }

  async function loadCheckinLogs() {
    const logs = await apiGet<
      { task_type: string; account_id: string | null; message: string | null }[]
    >("/system-task-logs");
    const cm: Record<string, string> = {};
    for (const l of logs) {
      if (
        l.task_type === "account_checkin" && l.account_id &&
        !(l.account_id in cm)
      ) cm[l.account_id] = l.message ?? "";
    }
    setCheckinMsg(cm);
  }

  async function loadSites(mode: LoadMode = "replace") {
    await loadCachedPage({
      state: sitePage,
      setState: setSitePage,
      req: siteReq,
      mode,
      key: siteKey,
      path: "/sites",
      params: { siteQ: qSite, accountQ: qAcc, apiKeyQ: qKey, modelQ: qMod },
    });
  }

  async function loadAccounts(mode: LoadMode = "replace") {
    await loadCachedPage({
      state: accountPage,
      setState: setAccountPage,
      req: accountReq,
      mode,
      key: accountKey,
      path: "/accounts",
      params: {
        siteQ: qSite,
        accountQ: qAcc,
        apiKeyQ: qKey,
        modelQ: qMod,
        siteId: sel.site,
      },
    });
  }

  async function loadKeys(mode: LoadMode = "replace") {
    await loadCachedPage({
      state: keyPage,
      setState: setKeyPage,
      req: keyReq,
      mode,
      key: keyKey,
      path: "/api-keys",
      params: {
        siteQ: qSite,
        accountQ: qAcc,
        apiKeyQ: qKey,
        modelQ: qMod,
        siteId: sel.site,
        accountId: sel.account,
      },
    });
  }

  async function loadUms(mode: LoadMode = "replace") {
    await loadCachedPage({
      state: umPage,
      setState: setUmPage,
      req: umReq,
      mode,
      key: umKey,
      path: "/upstream-models",
      params: {
        siteQ: qSite,
        accountQ: qAcc,
        apiKeyQ: qKey,
        modelQ: qMod,
        siteId: sel.site,
        accountId: sel.account,
        apiKeyId: sel.key,
      },
    });
  }

  async function reloadScope(scope: RefreshScope) {
    const jobs: Promise<void>[] = [];
    if (scope === "all" || scope === "site" || scope === "siteOnly") {
      jobs.push(loadSites("revalidate"));
    }
    if (["all", "site", "account"].includes(scope)) {
      jobs.push(loadAccounts("revalidate"));
    }
    if (["all", "site", "account", "key"].includes(scope)) {
      jobs.push(loadKeys("revalidate"));
    }
    if (["all", "site", "account", "key", "um", "models"].includes(scope)) {
      jobs.push(loadUms("revalidate"));
    }
    if (scope === "all" || scope === "models") jobs.push(loadModels());
    if (["all", "site", "account"].includes(scope)) {
      jobs.push(loadCheckinLogs());
    }
    await Promise.all(jobs);
  }

  function clearSiteColumn() {
    siteReq.current += 1;
    setSitePage(emptyPage());
  }
  function clearAccountColumn() {
    accountReq.current += 1;
    setAccountPage(emptyPage());
  }
  function clearKeyColumn() {
    keyReq.current += 1;
    setKeyPage(emptyPage());
  }
  function clearUmColumn() {
    umReq.current += 1;
    setUmPage(emptyPage());
  }

  useEffect(() => {
    void loadModels();
    void loadCheckinLogs();
  }, []);
  useEffect(() => {
    void loadSites("replace");
  }, [qSite, qAcc, qKey, qMod]);
  useEffect(() => {
    void loadAccounts("replace");
  }, [qSite, qAcc, qKey, qMod, sel.site]);
  useEffect(() => {
    void loadKeys("replace");
  }, [qSite, qAcc, qKey, qMod, sel.site, sel.account]);
  useEffect(() => {
    void loadUms("replace");
  }, [qSite, qAcc, qKey, qMod, sel.site, sel.account, sel.key]);

  return {
    sitePage,
    accountPage,
    keyPage,
    umPage,
    models,
    checkinMsg,
    loadSites,
    loadAccounts,
    loadKeys,
    loadUms,
    reloadScope,
    clearSiteColumn,
    clearAccountColumn,
    clearKeyColumn,
    clearUmColumn,
  };
}
