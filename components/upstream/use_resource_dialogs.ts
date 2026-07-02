import { apiSend } from "../admin_api.ts";
import { STATUS_MAP } from "./constants.ts";
import type {
  Account,
  CreateType,
  ModalSpec,
  RefreshScope,
  Selection,
  Site,
} from "./types.ts";
import { useState } from "preact/hooks";

export function useResourceDialogs(
  {
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
  }: {
    sel: Selection;
    sites: Site[];
    accounts: Account[];
    reloadScope: (scope: RefreshScope) => Promise<void>;
    setSel: (next: Partial<Selection>) => void;
    clearAccountColumn: () => void;
    clearKeyColumn: () => void;
    clearUmColumn: () => void;
    showFlash: (text: string, ok: boolean) => void;
    setBusy: (busy: string | null) => void;
  },
) {
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [nmFor, setNmFor] = useState<string | null>(null);
  const [nmName, setNmName] = useState("");
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function updateField(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      if (!(k in e)) return e;
      const n = { ...e };
      delete n[k];
      return n;
    });
  }

  function openCreate(type: CreateType) {
    setModal({ mode: "create", type });
    const preset: Record<string, string> = {};
    if (type === "account" && sel.site) preset.siteId = sel.site;
    if (type === "apikey" && sel.account) preset.accountId = sel.account;
    setForm(preset);
    setErrors({});
  }

  function openEditSite(s: Site) {
    setModal({ mode: "edit", type: "site", id: s.id });
    setForm({ name: s.name, origin: s.origin, remark: s.remark ?? "" });
    setErrors({});
  }

  function openEditAccount(a: Account) {
    setModal({ mode: "edit", type: "account", id: a.id });
    setForm({ name: a.name, userId: a.user_id, accessToken: a.access_token });
    setErrors({});
  }

  async function probeTitle() {
    const origin = (form.origin ?? "").trim();
    if (!origin) {
      showFlash("请先填写 Origin", false);
      return;
    }
    setProbing(true);
    try {
      const r = await apiSend<{ name?: string | null }>(
        "POST",
        "/sites/probe-name",
        { origin },
      );
      if (r.name) {
        setForm((f) => ({ ...f, name: r.name as string }));
        showFlash(`已获取站点名称：${r.name}`, true);
      } else {
        showFlash("未能获取站点名称，请手动填写", false);
      }
    } catch {
      showFlash("获取站点名称失败", false);
    } finally {
      setProbing(false);
    }
  }

  async function probeUsername() {
    const origin = sites.find((s) => s.id === form.siteId)?.origin;
    const userId = (form.userId ?? "").trim();
    const accessToken = (form.accessToken ?? "").trim();
    if (!origin) {
      showFlash("请先选择所属站点", false);
      return;
    }
    if (!userId || !accessToken) {
      showFlash("请先填写用户 ID 和 AccessToken", false);
      return;
    }
    setProbing(true);
    try {
      const r = await apiSend<{ name?: string | null }>(
        "POST",
        "/accounts/probe-name",
        { origin, userId, accessToken },
      );
      if (r.name) {
        setForm((f) => ({ ...f, name: r.name as string }));
        showFlash(`已获取账号名称：${r.name}`, true);
      } else {
        showFlash("未能获取账号名称，请手动填写", false);
      }
    } catch {
      showFlash("获取账号名称失败", false);
    } finally {
      setProbing(false);
    }
  }

  async function probeUsernameEdit(accountId: string) {
    setProbing(true);
    try {
      const r = await apiSend<{ name?: string | null }>(
        "POST",
        `/accounts/${accountId}/probe-name`,
        { userId: form.userId, accessToken: form.accessToken },
      );
      if (r.name) {
        updateField("name", r.name);
        showFlash(`已获取账号名称：${r.name}`, true);
      } else {
        showFlash("未能获取账号名称，请手动填写", false);
      }
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "获取账号名称失败", false);
    } finally {
      setProbing(false);
    }
  }

  function validate(m: ModalSpec): Record<string, string> {
    const e: Record<string, string> = {};
    const need = (k: string, msg: string) => {
      if (!(form[k] ?? "").trim()) e[k] = msg;
    };
    if (m.mode === "create") {
      if (m.type === "site") need("origin", "Origin 必填");
      else if (m.type === "account") {
        need("siteId", "请选择所属站点");
        need("userId", "用户 ID 必填");
        need("accessToken", "AccessToken 必填");
      } else {
        need("accountId", "请选择所属账号");
        need("name", "Key 名称必填");
        need("key", "Key 必填");
      }
    } else if (m.type === "site") {
      need("name", "站点名称必填");
      need("origin", "Origin 必填");
    } else {
      need("userId", "用户 ID 必填");
    }
    return e;
  }

  async function submitModal() {
    if (!modal || saving) return;
    const errs = validate(modal);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      let next: Selection | null = null;
      let checkSite: string | null = null;
      let updatedExisting = false;
      if (modal.mode === "create") {
        if (modal.type === "site") {
          const r = await apiSend<{ id?: string | number; updated?: boolean }>(
            "POST",
            "/sites",
            {
              name: form.name?.trim() || null,
              origin: form.origin,
              remark: form.remark || null,
            },
          );
          updatedExisting = !!r?.updated;
          if (r?.id != null) {
            next = { site: String(r.id), account: null, key: null };
            checkSite = String(r.id);
          }
        } else if (modal.type === "account") {
          const r = await apiSend<{ id?: string | number; updated?: boolean }>(
            "POST",
            "/accounts",
            {
              siteId: Number(form.siteId),
              name: form.name?.trim() || null,
              userId: form.userId,
              accessToken: form.accessToken,
            },
          );
          updatedExisting = !!r?.updated;
          if (r?.id != null) {
            next = { site: form.siteId, account: String(r.id), key: null };
          }
        } else {
          const siteId = accounts.find((a) =>
            a.id === form.accountId
          )?.site_id ?? null;
          const r = await apiSend<{ id?: string | number }>(
            "POST",
            "/api-keys",
            {
              accountId: Number(form.accountId),
              name: form.name,
              key: form.key,
            },
          );
          if (r?.id != null) {
            next = { site: siteId, account: form.accountId, key: String(r.id) };
          }
        }
      } else if (modal.type === "site") {
        await apiSend("PATCH", `/sites/${modal.id}`, {
          name: form.name,
          origin: form.origin,
          remark: form.remark || null,
        });
        checkSite = modal.id;
        next = sel.site === modal.id
          ? { site: modal.id, account: sel.account, key: sel.key }
          : { site: modal.id, account: null, key: null };
      } else {
        const payload: Record<string, unknown> = { userId: form.userId };
        const nm = form.name?.trim();
        if (nm) payload.name = nm;
        if (form.accessToken) payload.accessToken = form.accessToken;
        await apiSend("PATCH", `/accounts/${modal.id}`, payload);
        const acc = accounts.find((a) => a.id === modal.id);
        next = {
          site: acc?.site_id ?? sel.site,
          account: modal.id,
          key: sel.account === modal.id ? sel.key : null,
        };
      }
      await reloadScope(
        modal.type === "site"
          ? "site"
          : modal.type === "account"
          ? "account"
          : "key",
      );
      if (next) {
        if (next.site !== sel.site) {
          clearAccountColumn();
          clearKeyColumn();
          clearUmColumn();
        } else if (next.account !== sel.account) {
          clearKeyColumn();
          clearUmColumn();
        } else if (next.key !== sel.key) {
          clearUmColumn();
        }
        setSel(next);
      }
      setModal(null);
      const base = modal.mode === "create"
        ? (updatedExisting ? "该记录已存在，已更新" : "创建成功")
        : "已保存";
      showFlash(
        modal.type === "account"
          ? `${base}，正在后台刷新额度 / ApiKey / 模型`
          : base,
        true,
      );
      if (checkSite) void healthCheckSiteById(checkSite);
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "操作失败", false);
    } finally {
      setSaving(false);
    }
  }

  async function healthCheckSiteById(siteId: string) {
    setBusy("sitecheck" + siteId);
    try {
      const r = await apiSend<{ status?: string; httpStatus?: number }>(
        "POST",
        `/sites/${siteId}/health-check`,
      ).catch(() => null);
      await reloadScope("site");
      if (r) {
        const label = STATUS_MAP[r.status ?? "unknown"]?.[1] ?? r.status ?? "?";
        showFlash(
          `站点检测：${label}${r.httpStatus ? `（HTTP ${r.httpStatus}）` : ""}`,
          r.status === "healthy",
        );
      } else {
        showFlash("站点检测失败", false);
      }
    } finally {
      setBusy(null);
    }
  }

  function openNewModel(umId: string) {
    setNmFor(umId);
    setNmName("");
  }

  async function saveNewModel() {
    const name = nmName.trim();
    if (!name || !nmFor) return;
    try {
      const created = await apiSend<{ id?: number | string }>(
        "POST",
        "/models",
        { name },
      );
      if (created?.id != null) {
        await apiSend("PATCH", `/upstream-models/${nmFor}`, {
          modelId: Number(created.id),
        });
      }
      setNmFor(null);
      await reloadScope("models");
      showFlash(`已创建并映射「${name}」`, true);
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "创建失败", false);
    }
  }

  return {
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
    openNewModel,
    saveNewModel,
  };
}
