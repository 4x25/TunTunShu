import { useEffect, useState } from "preact/hooks";
import { apiSend, getToken } from "../components/admin_api.ts";
import { copyText } from "../components/clipboard.ts";
import { useUrlState } from "../components/use_url_state.ts";
import { AccountColumn } from "../components/upstream/AccountColumn.tsx";
import { ApiKeyColumn } from "../components/upstream/ApiKeyColumn.tsx";
import {
  CHECKIN_MAP,
  ENDPOINT_LABELS,
  hit,
  STATUS_MAP,
} from "../components/upstream/constants.ts";
import { useDebouncedValue } from "../components/upstream/list_state.ts";
import { LoginScriptModal } from "../components/upstream/LoginScriptModal.tsx";
import { NewModelModal } from "../components/upstream/NewModelModal.tsx";
import { ResourceModal } from "../components/upstream/ResourceModal.tsx";
import { SiteColumn } from "../components/upstream/SiteColumn.tsx";
import { TestResultModal } from "../components/upstream/TestResultModal.tsx";
import { UpstreamModelColumn } from "../components/upstream/UpstreamModelColumn.tsx";
import {
  buildAccountLoginHref,
  isUpstreamLoginScriptInstalled,
} from "../components/upstream/upstream_login.ts";
import { UpstreamToolbar } from "../components/upstream/UpstreamToolbar.tsx";
import { useResourceDialogs } from "../components/upstream/use_resource_dialogs.ts";
import { useUpstreamPages } from "../components/upstream/use_upstream_pages.ts";
import type {
  Account,
  ApiKey,
  Flash,
  JobSummary,
  RefreshScope,
  Selection,
  Site,
  TestKind,
  TestResult,
  TestView,
  UpstreamModel,
} from "../components/upstream/types.ts";

function openDetached(url: string) {
  globalThis.open(url, "_blank", "noopener,noreferrer");
}

export default function UpstreamApp() {
  const [u, setU] = useUrlState();
  const sel: Selection = {
    site: u.site ?? null,
    account: u.account ?? null,
    key: u.key ?? null,
  };
  const qSite = u.siteKeyword ?? "";
  const qAcc = u.accountKeyword ?? "";
  const qKey = u.keyKeyword ?? "";
  const qMod = u.modelKeyword ?? "";
  const qSiteDebounced = useDebouncedValue(qSite, 250);
  const qAccDebounced = useDebouncedValue(qAcc, 250);
  const qKeyDebounced = useDebouncedValue(qKey, 250);
  const qModDebounced = useDebouncedValue(qMod, 250);
  const {
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
  } = useUpstreamPages({
    sel,
    qSite: qSiteDebounced,
    qAcc: qAccDebounced,
    qKey: qKeyDebounced,
    qMod: qModDebounced,
  });

  const [openDd, setOpenDd] = useState<string | null>(null);
  const [ddFilter, setDdFilter] = useState("");
  const [openEp, setOpenEp] = useState<string | null>(null);
  const [testView, setTestView] = useState<TestView | null>(null);
  const [testOut, setTestOut] = useState<TestResult | "loading" | null>(null);
  const [loginHelpOpen, setLoginHelpOpen] = useState(false);

  const [flash, setFlash] = useState<Flash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const sites = sitePage.items;
  const accounts = accountPage.items;
  const keys = keyPage.items;
  const ums = umPage.items;
  const ddItems = models.filter((m) => hit(m.name, ddFilter));

  const setSel = (next: Partial<Selection>) => {
    const patch: Record<string, string> = {};
    if ("site" in next) patch.site = next.site ?? "";
    if ("account" in next) patch.account = next.account ?? "";
    if ("key" in next) patch.key = next.key ?? "";
    setU(patch);
  };

  function showFlash(text: string, ok: boolean) {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 4000);
  }

  const {
    modal,
    setModal,
    form,
    errors,
    nmFor,
    setNmFor,
    nmName,
    setNmName,
    probing,
    saving,
    updateField,
    openCreate,
    openEditSite,
    openEditAccount,
    probeTitle,
    probeUsername,
    probeUsernameEdit,
    submitModal,
    openNewModel: openNewModelDialog,
    saveNewModel,
  } = useResourceDialogs({
    sel,
    sites,
    accounts,
    reloadScope,
    setSel,
    clearAccountColumn,
    clearKeyColumn,
    clearUmColumn,
    showFlash,
    setBusy,
  });

  useEffect(() => {
    const onClick = () => {
      setOpenDd(null);
      setOpenEp(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenDd(null);
        setOpenEp(null);
        setModal(null);
        setNmFor(null);
        setTestView(null);
        setLoginHelpOpen(false);
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function act(
    label: string,
    fn: () => Promise<string>,
    refresh: RefreshScope = "all",
  ) {
    setBusy(label);
    try {
      const msg = await fn();
      await reloadScope(refresh);
      showFlash(msg, true);
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "操作失败", false);
    } finally {
      setBusy(null);
    }
  }

  const siteName = (id: string) =>
    sites.find((x) => x.id === id)?.name ?? `#${id}`;

  function pickSite(id: string) {
    clearAccountColumn();
    clearKeyColumn();
    clearUmColumn();
    setSel({ site: sel.site === id ? null : id, account: null, key: null });
  }
  function pickAccount(id: string) {
    clearKeyColumn();
    clearUmColumn();
    setSel({ account: sel.account === id ? null : id, key: null });
  }
  function pickKey(id: string) {
    clearUmColumn();
    setSel({ key: sel.key === id ? null : id });
  }
  function resetAll() {
    const hadFilters = Boolean(
      sel.site || sel.account || sel.key || qSite || qAcc || qKey || qMod,
    );
    if (hadFilters) {
      clearSiteColumn();
      clearAccountColumn();
      clearKeyColumn();
      clearUmColumn();
    }
    setU({
      site: "",
      account: "",
      key: "",
      siteKeyword: "",
      accountKeyword: "",
      keyKeyword: "",
      modelKeyword: "",
    });
    if (!hadFilters) {
      void reloadScope("all").catch((e) =>
        showFlash(e instanceof Error ? e.message : "刷新失败", false)
      );
    }
  }

  const toggleSite = (s: Site) =>
    act(
      "toggle",
      async () => {
        await apiSend("PATCH", `/sites/${s.id}`, { enabled: !s.enabled });
        return `站点「${s.name}」已${s.enabled ? "停用" : "启用"}`;
      },
      "siteOnly",
    );
  const toggleAcc = (a: Account) =>
    act(
      "toggle",
      async () => {
        await apiSend("PATCH", `/accounts/${a.id}`, { enabled: !a.enabled });
        return `账号「${a.name}」已${a.enabled ? "停用" : "启用"}`;
      },
      "account",
    );
  const toggleKey = (k: ApiKey) =>
    act(
      "toggle",
      async () => {
        await apiSend("PATCH", `/api-keys/${k.id}`, { enabled: !k.enabled });
        return `Key「${k.name}」已${k.enabled ? "停用" : "启用"}`;
      },
      "key",
    );
  const toggleUm = (m: UpstreamModel) =>
    act(
      "toggle",
      async () => {
        await apiSend("PATCH", `/upstream-models/${m.id}`, {
          enabled: !m.enabled,
        });
        return `模型「${m.name}」已${m.enabled ? "停用" : "启用"}`;
      },
      "um",
    );

  const healthCheck = (s: Site) =>
    act(
      "hc" + s.id,
      async () => {
        const r = await apiSend<{
          status?: string;
          httpStatus?: number;
          newApi?: boolean;
          error?: string;
          site?: {
            id?: number;
            status?: string;
            enabled?: boolean;
            status_data?: { checkin_enabled?: boolean } | null;
          } | null;
        }>(
          "POST",
          `/sites/${s.id}/health-check`,
        );
        // 检测接口现在回传整行站点数据,直接打到控制台方便排查。
        console.log("[site health-check]", r);
        const checkinEnabled = r.site?.status_data?.checkin_enabled;
        return `「${s.name}」检测：${r.status ?? "?"}${
          r.httpStatus ? ` (HTTP ${r.httpStatus})` : ""
        }${
          checkinEnabled === undefined
            ? ""
            : ` · checkin_enabled=${checkinEnabled}`
        }`;
      },
      "siteOnly",
    );
  const checkin = (a: Account) =>
    act(
      "ci" + a.id,
      async () => {
        const r = await apiSend<
          {
            checkinStatus?: string;
            error?: string;
            skipped?: boolean;
            message?: string;
          }
        >(
          "POST",
          `/accounts/${a.id}/checkin`,
        );
        if (r.skipped) {
          return `「${a.name}」签到：${r.message ?? "站点未开放签到功能"}`;
        }
        const checkinMsg = `「${a.name}」签到：${
          CHECKIN_MAP[r.checkinStatus ?? "unknown"]?.[1] ?? r.checkinStatus ??
            r.error ?? "?"
        }`;
        if (r.checkinStatus !== "checked") return checkinMsg;
        const quota = await apiSend<{ ok?: boolean }>(
          "POST",
          `/accounts/${a.id}/sync-quota`,
        ).catch(() => null);
        return `${checkinMsg} · ${quota?.ok ? "额度已更新" : "额度刷新失败"}`;
      },
      "account",
    );
  const checkAccount = (a: Account) =>
    act(
      "ac" + a.id,
      async () => {
        const r = await apiSend<{
          ok?: boolean;
          data?: {
            ok?: boolean;
            quota?: string;
            usedQuota?: string;
            status?: string;
            checkinStatus?: string | null;
          } | null;
          keys?: {
            ok?: boolean;
            count?: number;
            newKeys?: number;
            pruned?: number;
            error?: string;
          } | null;
        }>(
          "POST",
          `/accounts/${a.id}/sync`,
        );
        const dataPart = r.data?.ok === true
          ? `账号正常${
            r.data.status
              ? `(${STATUS_MAP[r.data.status] ?? r.data.status})`
              : ""
          }`
          : "账号数据同步失败";
        const keysPart = r.keys?.ok === true
          ? `发现 ${r.keys.count ?? 0} 个 Key${
            (r.keys.newKeys ?? 0) > 0 ? `（新增 ${r.keys.newKeys}）` : ""
          }${(r.keys.pruned ?? 0) > 0 ? `，清理 ${r.keys.pruned}` : ""}`
          : `Key 同步失败${r.keys?.error ? `：${r.keys.error}` : ""}`;
        const msg = `「${a.name}」检测：${dataPart} · ${keysPart}`;
        if (r.ok === false) throw new Error(msg);
        return msg;
      },
      "account",
    );
  const syncModels = (k: ApiKey) =>
    act(
      "sm" + k.id,
      async () => {
        const r = await apiSend<{ count?: number }>(
          "POST",
          `/api-keys/${k.id}/sync-models`,
        );
        return `「${k.name}」发现 ${r.count ?? 0} 个模型`;
      },
      "key",
    );

  function batchPart(name: string, r: JobSummary): string {
    return `${name}：共 ${r.total} · 成功 ${r.success} · 失败 ${r.failed}${
      r.skipped > 0 ? ` · 跳过 ${r.skipped}` : ""
    }`;
  }
  const batchSiteCheck = () =>
    act(
      "batch-site",
      async () => {
        const r = await apiSend<JobSummary>(
          "POST",
          "/tasks/site-health-check",
        );
        return batchPart("批量检测站点", r);
      },
      "siteOnly",
    );
  const batchAccountRun = () =>
    act(
      "batch-account",
      async () => {
        const sync = await apiSend<JobSummary>(
          "POST",
          "/tasks/account-quota-sync",
        );
        let checkinPart: string;
        try {
          const ci = await apiSend<JobSummary>(
            "POST",
            "/tasks/account-checkin",
          );
          checkinPart = batchPart("批量签到", ci);
        } catch (e) {
          checkinPart = `批量签到：请求失败(${
            e instanceof Error ? e.message : "error"
          })`;
        }
        return `${batchPart("批量检测", sync)}；${checkinPart}`;
      },
      "account",
    );
  const batchKeySyncModels = () =>
    act(
      "batch-key",
      async () => {
        const r = await apiSend<JobSummary>(
          "POST",
          "/tasks/api-key-model-sync",
        );
        return batchPart("批量拉取模型", r);
      },
      "key",
    );

  // 复制不改数据，故不走 act()（无需刷新列表）：成功后按钮短暂显示对勾
  async function copyKey(k: ApiKey) {
    try {
      await copyText(k.key);
      setCopiedKey(k.id);
      setTimeout(
        () => setCopiedKey((cur) => cur === k.id ? null : cur),
        1500,
      );
      showFlash(`Key「${k.name}」的密钥已复制到剪贴板`, true);
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "复制失败", false);
    }
  }

  function selectedAccountSiteId() {
    if (!sel.account) return null;
    return accounts.find((account) => account.id === sel.account)?.site_id ??
      null;
  }

  function selectedKeyAccountId() {
    if (!sel.key) return null;
    return keys.find((key) => key.id === sel.key)?.account_id ?? null;
  }

  function selectedKeySiteId() {
    const accountId = selectedKeyAccountId();
    if (!accountId) return null;
    return accounts.find((account) => account.id === accountId)?.site_id ??
      null;
  }

  const delSite = (s: Site) => {
    if (!confirm(`删除站点「${s.name}」及其下所有账号/Key/模型？`)) return;
    const clearsSelection = sel.site === s.id ||
      selectedAccountSiteId() === s.id ||
      selectedKeySiteId() === s.id;
    act(
      "del",
      async () => {
        await apiSend("DELETE", `/sites/${s.id}`);
        if (clearsSelection) {
          clearAccountColumn();
          clearKeyColumn();
          clearUmColumn();
          setSel({ site: null, account: null, key: null });
        }
        return `站点「${s.name}」已删除`;
      },
      "site",
    );
  };
  const delAcc = (a: Account) => {
    if (!confirm(`删除账号「${a.name}」及其下所有 Key/模型？`)) return;
    const clearsSelection = sel.account === a.id ||
      selectedKeyAccountId() === a.id;
    act(
      "del",
      async () => {
        await apiSend("DELETE", `/accounts/${a.id}`);
        if (clearsSelection) {
          clearKeyColumn();
          clearUmColumn();
          setSel({ account: null, key: null });
        }
        return `账号「${a.name}」已删除`;
      },
      "account",
    );
  };
  const delKey = (k: ApiKey) => {
    if (!confirm(`删除 Key「${k.name}」及其下模型？`)) return;
    const clearsSelection = sel.key === k.id;
    act(
      "del",
      async () => {
        await apiSend("DELETE", `/api-keys/${k.id}`);
        if (clearsSelection) {
          clearUmColumn();
          setSel({ key: null });
        }
        return `Key「${k.name}」已删除`;
      },
      "key",
    );
  };

  const setEndpoint = (m: UpstreamModel, ep: string) => {
    setOpenEp(null);
    if (ep === m.endpoint_type) return;
    act(
      "ep" + m.id,
      async () => {
        await apiSend("PATCH", `/upstream-models/${m.id}`, {
          endpointType: ep,
        });
        return `「${m.name}」端点已切换为 ${ENDPOINT_LABELS[ep] ?? ep}`;
      },
      "um",
    );
  };
  const setMap = (umId: string, modelId: string | null) => {
    setOpenDd(null);
    act(
      "map" + umId,
      async () => {
        await apiSend("PATCH", `/upstream-models/${umId}`, { modelId });
        return modelId ? "映射已更新" : "已解除映射";
      },
      "um",
    );
  };

  async function runTest(m: UpstreamModel, kind: TestKind) {
    setTestView({ id: m.id, name: m.name, kind });
    setTestOut("loading");
    const fail = (reason: string, error: string): TestResult => ({
      endpointType: m.endpoint_type,
      kind,
      prompt: "",
      reply: "",
      toolCalls: [],
      pass: false,
      reason,
      latencyMs: 0,
      error,
    });
    try {
      const res = await fetch(`/api/upstream-models/${m.id}/test`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => null) as TestResult | null;
      setTestOut(
        res.ok && data ? data : fail("请求失败", `HTTP ${res.status}`),
      );
    } catch (e) {
      setTestOut(fail("请求失败", e instanceof Error ? e.message : "error"));
    }
  }

  function rerunTest() {
    if (!testView) return;
    const m = ums.find((x) => x.id === testView.id);
    if (m) void runTest(m, testView.kind);
  }

  function openNewModel(umId: string) {
    setOpenDd(null);
    openNewModelDialog(umId);
  }

  const refreshAll = () =>
    void reloadScope("all").catch((e) =>
      showFlash(e instanceof Error ? e.message : "刷新失败", false)
    );
  const quickEntryUrl = `/tuntunshu.user.js?key=${
    encodeURIComponent(getToken())
  }`;
  // 合并后的「囤囤鼠脚本」同时承担快捷录入与上游免登,只有一个安装入口。
  const installScript = () => {
    openDetached(quickEntryUrl);
  };
  // 免登脚本的 marker 在 document-start 注入,页面存续期内不会变化;
  // 脚本未就绪时绝不把 PAT 写进「登录」链接的 href。
  const loginScriptInstalled = isUpstreamLoginScriptInstalled(globalThis);
  const loginHref = (account: Account): string | undefined =>
    buildAccountLoginHref(
      loginScriptInstalled,
      account.site_origin ??
        sites.find((candidate) => candidate.id === account.site_id)?.origin,
      account.access_token,
      account.user_id,
    ) ?? undefined;
  // 「登录」是真实 <a>:有 href 时由浏览器原生新标签打开,不会进入本函数;
  // 这里只处理链接不可用(未装脚本 / Origin 缺失或非法)的分支。
  const loginUpstream = (account: Account) => {
    if (!loginScriptInstalled) {
      setLoginHelpOpen(true);
      return;
    }
    const siteOrigin = account.site_origin ??
      sites.find((candidate) => candidate.id === account.site_id)?.origin;
    if (!siteOrigin) {
      showFlash(`未找到账号「${account.name}」所属站点`, false);
      return;
    }
    showFlash("站点 Origin 无效，请编辑站点后重试", false);
  };

  return (
    <>
      <UpstreamToolbar
        flash={flash}
        busy={busy}
        onRefresh={refreshAll}
        onReset={resetAll}
        onInstallScript={installScript}
      />

      <div class="miller">
        <SiteColumn
          page={sitePage}
          rows={sites}
          q={qSite}
          selectedId={sel.site}
          busy={busy}
          onKeywordChange={(value) => setU({ siteKeyword: value })}
          onLoadMore={() => void loadSites("append")}
          onCreate={() => openCreate("site")}
          onBatch={batchSiteCheck}
          onPick={pickSite}
          onToggle={toggleSite}
          onHealthCheck={healthCheck}
          onEdit={openEditSite}
          onDelete={delSite}
        />
        <AccountColumn
          page={accountPage}
          rows={accounts}
          q={qAcc}
          selectedId={sel.account}
          selectedSiteId={sel.site}
          busy={busy}
          checkinMsg={checkinMsg}
          onKeywordChange={(value) => setU({ accountKeyword: value })}
          onLoadMore={() => void loadAccounts("append")}
          onCreate={() => openCreate("account")}
          onBatch={batchAccountRun}
          onPick={pickAccount}
          onToggle={toggleAcc}
          onLogin={loginUpstream}
          loginHref={loginHref}
          onCheckin={checkin}
          onCheck={checkAccount}
          onEdit={openEditAccount}
          onDelete={delAcc}
        />
        <ApiKeyColumn
          page={keyPage}
          rows={keys}
          q={qKey}
          selectedId={sel.key}
          selectedAccountId={sel.account}
          busy={busy}
          copiedId={copiedKey}
          onKeywordChange={(value) => setU({ keyKeyword: value })}
          onLoadMore={() => void loadKeys("append")}
          onCreate={() => openCreate("apikey")}
          onBatch={batchKeySyncModels}
          onPick={pickKey}
          onToggle={toggleKey}
          onCopyKey={(k) => void copyKey(k)}
          onSyncModels={syncModels}
          onDelete={delKey}
        />
        <UpstreamModelColumn
          page={umPage}
          rows={ums}
          q={qMod}
          selectedKeyId={sel.key}
          models={models}
          ddItems={ddItems}
          ddFilter={ddFilter}
          openDd={openDd}
          openEp={openEp}
          busy={busy}
          onKeywordChange={(value) => setU({ modelKeyword: value })}
          onLoadMore={() => void loadUms("append")}
          onToggle={toggleUm}
          onEndpointMenuToggle={(id) => {
            setOpenDd(null);
            setOpenEp((cur) => cur === id ? null : id);
          }}
          onMapMenuToggle={(id) => {
            setDdFilter("");
            setOpenEp(null);
            setOpenDd((cur) => cur === id ? null : id);
          }}
          onDdFilterChange={setDdFilter}
          onEndpointSelect={setEndpoint}
          onMap={setMap}
          onOpenNewModel={openNewModel}
          onRunTest={(m, kind) => void runTest(m, kind)}
        />
      </div>

      <ResourceModal
        modal={modal}
        form={form}
        errors={errors}
        sites={sites}
        accounts={accounts}
        saving={saving}
        probing={probing}
        siteName={siteName}
        onClose={() => setModal(null)}
        onFieldChange={updateField}
        onProbeTitle={() => void probeTitle()}
        onProbeUsername={() => void probeUsername()}
        onProbeUsernameEdit={(id) => void probeUsernameEdit(id)}
        onSubmit={() => void submitModal()}
      />
      <NewModelModal
        open={nmFor !== null}
        name={nmName}
        onClose={() => setNmFor(null)}
        onNameChange={setNmName}
        onSave={() => void saveNewModel()}
      />
      <TestResultModal
        testView={testView}
        testOut={testOut}
        onClose={() => setTestView(null)}
        onRunAgain={rerunTest}
      />
      <LoginScriptModal
        open={loginHelpOpen}
        onClose={() => setLoginHelpOpen(false)}
        installHref={quickEntryUrl}
      />
    </>
  );
}
