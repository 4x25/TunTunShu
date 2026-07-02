import { useEffect, useRef, useState } from "preact/hooks";
import { apiGet, apiPage } from "../admin_api.ts";
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

  async function loadSites(append = false) {
    if (
      append &&
      (sitePage.loading || sitePage.loadingMore ||
        sitePage.items.length >= sitePage.totalCount)
    ) return;
    const pageIndex = append ? sitePage.pageIndex + 1 : 1;
    const version = ++siteReq.current;
    setSitePage((prev) => ({
      ...prev,
      items: append ? prev.items : [],
      pageIndex: append ? prev.pageIndex : 0,
      totalCount: append ? prev.totalCount : 0,
      loading: !append,
      loadingMore: append,
      error: null,
    }));
    try {
      const page = await apiPage<Site>("/sites", {
        pageIndex,
        pageSize: PAGE_SIZE,
        q: qSite,
      });
      if (version !== siteReq.current) return;
      setSitePage((prev) => mergePage(prev, page, append));
    } catch (error) {
      if (version !== siteReq.current) return;
      setSitePage((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: errorMessage(error),
      }));
    }
  }

  async function loadAccounts(append = false) {
    if (
      append &&
      (accountPage.loading || accountPage.loadingMore ||
        accountPage.items.length >= accountPage.totalCount)
    ) return;
    const pageIndex = append ? accountPage.pageIndex + 1 : 1;
    const version = ++accountReq.current;
    setAccountPage((prev) => ({
      ...prev,
      items: append ? prev.items : [],
      pageIndex: append ? prev.pageIndex : 0,
      totalCount: append ? prev.totalCount : 0,
      loading: !append,
      loadingMore: append,
      error: null,
    }));
    try {
      const page = await apiPage<Account>("/accounts", {
        pageIndex,
        pageSize: PAGE_SIZE,
        q: qAcc,
        siteId: sel.site,
      });
      if (version !== accountReq.current) return;
      setAccountPage((prev) => mergePage(prev, page, append));
    } catch (error) {
      if (version !== accountReq.current) return;
      setAccountPage((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: errorMessage(error),
      }));
    }
  }

  async function loadKeys(append = false) {
    if (
      append &&
      (keyPage.loading || keyPage.loadingMore ||
        keyPage.items.length >= keyPage.totalCount)
    ) return;
    const pageIndex = append ? keyPage.pageIndex + 1 : 1;
    const version = ++keyReq.current;
    setKeyPage((prev) => ({
      ...prev,
      items: append ? prev.items : [],
      pageIndex: append ? prev.pageIndex : 0,
      totalCount: append ? prev.totalCount : 0,
      loading: !append,
      loadingMore: append,
      error: null,
    }));
    try {
      const page = await apiPage<ApiKey>("/api-keys", {
        pageIndex,
        pageSize: PAGE_SIZE,
        q: qKey,
        siteId: sel.site,
        accountId: sel.account,
      });
      if (version !== keyReq.current) return;
      setKeyPage((prev) => mergePage(prev, page, append));
    } catch (error) {
      if (version !== keyReq.current) return;
      setKeyPage((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: errorMessage(error),
      }));
    }
  }

  async function loadUms(append = false) {
    if (
      append &&
      (umPage.loading || umPage.loadingMore ||
        umPage.items.length >= umPage.totalCount)
    ) return;
    const pageIndex = append ? umPage.pageIndex + 1 : 1;
    const version = ++umReq.current;
    setUmPage((prev) => ({
      ...prev,
      items: append ? prev.items : [],
      pageIndex: append ? prev.pageIndex : 0,
      totalCount: append ? prev.totalCount : 0,
      loading: !append,
      loadingMore: append,
      error: null,
    }));
    try {
      const page = await apiPage<UpstreamModel>("/upstream-models", {
        pageIndex,
        pageSize: PAGE_SIZE,
        q: qMod,
        siteId: sel.site,
        accountId: sel.account,
        apiKeyId: sel.key,
      });
      if (version !== umReq.current) return;
      setUmPage((prev) => mergePage(prev, page, append));
    } catch (error) {
      if (version !== umReq.current) return;
      setUmPage((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: errorMessage(error),
      }));
    }
  }

  async function reloadScope(scope: RefreshScope) {
    const jobs: Promise<void>[] = [];
    if (scope === "all" || scope === "site") jobs.push(loadSites());
    if (["all", "site", "account"].includes(scope)) jobs.push(loadAccounts());
    if (["all", "site", "account", "key"].includes(scope)) {
      jobs.push(loadKeys());
    }
    if (["all", "site", "account", "key", "um", "models"].includes(scope)) {
      jobs.push(loadUms());
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
    void loadSites();
  }, [qSite]);
  useEffect(() => {
    void loadAccounts();
  }, [qAcc, sel.site]);
  useEffect(() => {
    void loadKeys();
  }, [qKey, sel.site, sel.account]);
  useEffect(() => {
    void loadUms();
  }, [qMod, sel.site, sel.account, sel.key]);

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
