import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import { IconClose, IconSearch } from "../components/icons.tsx";
import { Modal } from "../components/Modal.tsx";
import { apiGet, apiSend, getToken } from "../components/admin_api.ts";

interface Site {
  id: string;
  name: string;
  origin: string;
  enabled: boolean;
  status: string;
  remark: string | null;
}
interface Account {
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
interface ApiKey {
  id: string;
  account_id: string;
  name: string;
  key: string;
  enabled: boolean;
  status: string;
}
interface UpstreamModel {
  id: string;
  api_key_id: string;
  model_id: string | null;
  name: string;
  enabled: boolean;
  status: string;
}
interface Model {
  id: string;
  name: string;
}

const STATUS_MAP: Record<string, [string, string]> = {
  healthy: ["ok", "正常"],
  down: ["bad", "异常"],
  invalid: ["bad", "失效"],
  quota_empty: ["warn", "额度耗尽"],
  unknown: ["mute", "未知"],
};
function Pill({ status }: { status: string }) {
  const x = STATUS_MAP[status] || STATUS_MAP.unknown;
  return (
    <span class={`pill pill-${x[0]}`}>
      <span class="dot"></span>
      {x[1]}
    </span>
  );
}
const CHECKIN_MAP: Record<string, [string, string]> = {
  checked: ["ok", "已签到"],
  unchecked: ["mute", "未签到"],
  failed: ["bad", "签到失败"],
  manual_required: ["warn", "需手动"],
  unknown: ["mute", "未知"],
};
function Switch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <span class="sw-wrap" onClick={(e) => e.stopPropagation()}>
      <label class="switch">
        <input type="checkbox" checked={on} onChange={onChange} />
        <span class="track"></span>
      </label>
    </span>
  );
}
function hit(s: string, q: string) {
  return s.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0;
}
function maskKey(k: string) {
  return k.length > 12 ? `${k.slice(0, 6)}••••${k.slice(-4)}` : k;
}
const QUOTA_PER_USD = 500000; // new-api 约定:500000 quota = $1
function usd(quota: string) {
  return (Number(quota) / QUOTA_PER_USD);
}

// ── Miller 列统一的行结构组件 ───────────────────────────────────────
// 四列(站点/账号/APIKey/模型)共用同一套 DOM 结构与 className,保证视觉一致。
/** 列表行外壳:统一 .mrow + sel/off/leaf 状态类与点击下钻。 */
function MillerRow(
  { selected, off, leaf, onClick, children }: {
    selected?: boolean;
    off?: boolean;
    leaf?: boolean;
    onClick?: () => void;
    children: ComponentChildren;
  },
) {
  return (
    <div
      class={`mrow${leaf ? " leaf" : ""}${selected ? " sel" : ""}${
        off ? " off" : ""
      }`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
/** 行首(l1):名称 + 状态徽标 + 启停开关。 */
function RowHead(
  { name, status, on, onToggle }: {
    name: string;
    status: string;
    on: boolean;
    onToggle: () => void;
  },
) {
  return (
    <div class="l1">
      <span class="nm">{name}</span>
      <Pill status={status} />
      <Switch on={on} onChange={onToggle} />
    </div>
  );
}
/** 行副信息(l2):origin / userId / 掩码 key 等。 */
function RowSub({ children }: { children: ComponentChildren }) {
  return <div class="l2">{children}</div>;
}
/** 行操作脚(l3):可选左侧内容 + 右对齐按钮组,各列布局一致。 */
function RowActions(
  { left, children }: { left?: ComponentChildren; children: ComponentChildren },
) {
  return (
    <div class="row-actions">
      {left && <div class="ra-left">{left}</div>}
      <div class="ra-btns">{children}</div>
    </div>
  );
}
/** 行内操作按钮:统一 ghost-sm 样式 + 阻止冒泡(避免触发整行下钻)。 */
function ActBtn(
  { onClick, danger, disabled, title, tone, children }: {
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
    title?: string;
    tone?: "ok" | "bad";
    children: ComponentChildren;
  },
) {
  const color = tone === "ok"
    ? "var(--ok)"
    : (tone === "bad" || danger)
    ? "var(--bad)"
    : undefined;
  return (
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      style={color ? `color:${color}` : undefined}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

type CreateType = "site" | "account" | "apikey";
type ModalSpec =
  | { mode: "create"; type: CreateType }
  | { mode: "edit"; type: "site" | "account"; id: string };

export default function UpstreamApp() {
  const [sites, setSites] = useState<Site[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [ums, setUms] = useState<UpstreamModel[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);

  const [sel, setSel] = useState<
    { site: string | null; account: string | null; key: string | null }
  >({ site: null, account: null, key: null });
  const [qSite, setQSite] = useState("");
  const [qAcc, setQAcc] = useState("");
  const [qKey, setQKey] = useState("");
  const [qMod, setQMod] = useState("");

  const [openDd, setOpenDd] = useState<string | null>(null);
  const [ddFilter, setDdFilter] = useState("");

  const [modal, setModal] = useState<ModalSpec | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [nmFor, setNmFor] = useState<string | null>(null); // upstream model id
  const [nmName, setNmName] = useState("");
  // accountId → 最近一次签到日志信息(签到失败时 hover 显示原因)
  const [checkinMsg, setCheckinMsg] = useState<Record<string, string>>({});
  const [probing, setProbing] = useState(false); // 抓取网页标题中

  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); // 弹窗保存请求进行中
  const [errors, setErrors] = useState<Record<string, string>>({}); // 字段校验错误

  async function load() {
    setLoading(true);
    try {
      const [s, a, k, u, m, logs] = await Promise.all([
        apiGet<Site[]>("/sites"),
        apiGet<Account[]>("/accounts"),
        apiGet<ApiKey[]>("/api-keys"),
        apiGet<UpstreamModel[]>("/upstream-models"),
        apiGet<Model[]>("/models"),
        apiGet<
          {
            task_type: string;
            account_id: string | null;
            message: string | null;
          }[]
        >("/system-task-logs"),
      ]);
      setSites(s);
      setAccounts(a);
      setKeys(k);
      setUms(u);
      setModels(m);
      // 日志按 id 倒序;取每个账号最新一条签到日志的信息
      const cm: Record<string, string> = {};
      for (const l of logs) {
        if (
          l.task_type === "account_checkin" && l.account_id &&
          !(l.account_id in cm)
        ) cm[l.account_id] = l.message ?? "";
      }
      setCheckinMsg(cm);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const onClick = () => setOpenDd(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenDd(null);
        setModal(null);
        setNmFor(null);
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function showFlash(text: string, ok: boolean) {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 4000);
  }
  /** 执行一个动作:置 busy、调用、刷新、回显结果。 */
  async function act(label: string, fn: () => Promise<string>) {
    setBusy(label);
    try {
      const msg = await fn();
      await load();
      showFlash(msg, true);
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "操作失败", false);
    } finally {
      setBusy(null);
    }
  }

  /** 用户编辑字段:写入 form 并清掉该字段的校验错误高亮。 */
  function updateField(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      if (!(k in e)) return e;
      const n = { ...e };
      delete n[k];
      return n;
    });
  }

  const siteName = (id: string) => sites.find((x) => x.id === id)?.name ?? "";

  function pickSite(id: string) {
    setSel((s) => ({
      site: s.site === id ? null : id,
      account: null,
      key: null,
    }));
  }
  function pickAccount(id: string) {
    setSel((s) => ({ ...s, account: s.account === id ? null : id, key: null }));
  }
  function pickKey(id: string) {
    setSel((s) => ({ ...s, key: s.key === id ? null : id }));
  }
  function resetAll() {
    setSel({ site: null, account: null, key: null });
    setQSite("");
    setQAcc("");
    setQKey("");
    setQMod("");
  }

  // ── 逐级级联过滤 ────────────────────────────────────────────────────
  // 每列候选 = 上级选中项的子集;上级未选中时 = 上级当前整列的并集。
  const siteRows = sites.filter((s) => hit(s.name + " " + s.origin, qSite));

  const accParent = sel.site != null
    ? new Set([sel.site])
    : new Set(siteRows.map((s) => s.id));
  const accRows = accounts.filter((a) =>
    accParent.has(a.site_id) && hit(a.name + " " + a.user_id, qAcc)
  );

  const keyParent = sel.account != null
    ? new Set([sel.account])
    : new Set(accRows.map((a) => a.id));
  const keyRows = keys.filter((k) =>
    keyParent.has(k.account_id) && hit(k.name + " " + k.key, qKey)
  );

  const modParent = sel.key != null
    ? new Set([sel.key])
    : new Set(keyRows.map((k) => k.id));
  const modRows = ums.filter((m) => {
    const mapped = m.model_id
      ? models.find((x) => x.id === m.model_id)?.name ?? ""
      : "";
    return modParent.has(m.api_key_id) && hit(m.name + " " + mapped, qMod);
  });
  const ddItems = models.filter((m) => hit(m.name, ddFilter));

  // 某列恰好一项 → 落实到 sel(渲染期写入,sel 始终是唯一真相)。Preact 的
  // enqueueRender 走微任务,在提交后、绘制前同一拍收敛重渲染,故首帧即正确、无闪烁。
  // 候选数按「上级选中」级联,但**忽略各列搜索框**(用 *Pool 而非用于渲染的
  // *Rows):否则在搜索框里把列表筛成一项时会被强制选中且无法取消。
  // 只填补未选中的层级、绝不清除已选,最多两三帧即收敛、不反复。
  const accPool = sel.site != null
    ? accounts.filter((a) => a.site_id === sel.site)
    : accounts;
  const keyPool = sel.account != null
    ? keys.filter((k) => k.account_id === sel.account)
    : keys;
  const want = {
    site: sel.site ?? (sites.length === 1 ? sites[0].id : null),
    account: sel.account ?? (accPool.length === 1 ? accPool[0].id : null),
    key: sel.key ?? (keyPool.length === 1 ? keyPool[0].id : null),
  };
  if (
    want.site !== sel.site || want.account !== sel.account ||
    want.key !== sel.key
  ) {
    setSel(want);
  }

  // ── 动作 ──────────────────────────────────────────────────────────
  const toggleSite = (s: Site) =>
    act("toggle", async () => {
      await apiSend("PATCH", `/sites/${s.id}`, { enabled: !s.enabled });
      return `站点「${s.name}」已${s.enabled ? "停用" : "启用"}`;
    });
  const toggleAcc = (a: Account) =>
    act("toggle", async () => {
      await apiSend("PATCH", `/accounts/${a.id}`, { enabled: !a.enabled });
      return `账号「${a.name}」已${a.enabled ? "停用" : "启用"}`;
    });
  const toggleKey = (k: ApiKey) =>
    act("toggle", async () => {
      await apiSend("PATCH", `/api-keys/${k.id}`, { enabled: !k.enabled });
      return `Key「${k.name}」已${k.enabled ? "停用" : "启用"}`;
    });
  const toggleUm = (m: UpstreamModel) =>
    act("toggle", async () => {
      await apiSend("PATCH", `/upstream-models/${m.id}`, {
        enabled: !m.enabled,
      });
      return `模型「${m.name}」已${m.enabled ? "停用" : "启用"}`;
    });

  const healthCheck = (s: Site) =>
    act("hc" + s.id, async () => {
      const r = await apiSend<{ status?: string; httpStatus?: number }>(
        "POST",
        `/sites/${s.id}/health-check`,
      );
      return `「${s.name}」检测：${r.status ?? "?"}${
        r.httpStatus ? ` (HTTP ${r.httpStatus})` : ""
      }`;
    });
  const checkin = (a: Account) =>
    act("ci" + a.id, async () => {
      const r = await apiSend<{ checkinStatus?: string; error?: string }>(
        "POST",
        `/accounts/${a.id}/checkin`,
      );
      const checkinMsg = `「${a.name}」签到：${
        CHECKIN_MAP[r.checkinStatus ?? "unknown"]?.[1] ?? r.checkinStatus ??
          r.error ?? "?"
      }`;
      // 签到后顺带刷新额度。best-effort,失败不影响签到结果。
      const quota = await apiSend<{ ok?: boolean }>(
        "POST",
        `/accounts/${a.id}/sync-quota`,
      ).catch(() => null);
      return `${checkinMsg} · ${quota?.ok ? "额度已更新" : "额度刷新失败"}`;
    });
  const syncKeys = (a: Account) =>
    act("sk" + a.id, async () => {
      const r = await apiSend<{ count?: number }>(
        "POST",
        `/accounts/${a.id}/sync-api-keys`,
      );
      return `「${a.name}」发现 ${r.count ?? 0} 个 APIKey`;
    });
  const syncModels = (k: ApiKey) =>
    act("sm" + k.id, async () => {
      const r = await apiSend<{ count?: number }>(
        "POST",
        `/api-keys/${k.id}/sync-models`,
      );
      return `「${k.name}」发现 ${r.count ?? 0} 个模型`;
    });

  const delSite = (s: Site) => {
    if (!confirm(`删除站点「${s.name}」及其下所有账号/Key/模型？`)) return;
    act("del", async () => {
      await apiSend("DELETE", `/sites/${s.id}`);
      setSel({ site: null, account: null, key: null });
      return `站点「${s.name}」已删除`;
    });
  };
  const delAcc = (a: Account) => {
    if (!confirm(`删除账号「${a.name}」及其下所有 Key/模型？`)) return;
    act("del", async () => {
      await apiSend("DELETE", `/accounts/${a.id}`);
      setSel((p) => ({ ...p, account: null, key: null }));
      return `账号「${a.name}」已删除`;
    });
  };
  const delKey = (k: ApiKey) => {
    if (!confirm(`删除 Key「${k.name}」及其下模型？`)) return;
    act("del", async () => {
      await apiSend("DELETE", `/api-keys/${k.id}`);
      setSel((p) => ({ ...p, key: null }));
      return `Key「${k.name}」已删除`;
    });
  };

  const setMap = (umId: string, modelId: string | null) => {
    setOpenDd(null);
    act("map", async () => {
      await apiSend("PATCH", `/upstream-models/${umId}`, { modelId });
      return modelId ? "映射已更新" : "已解除映射";
    });
  };

  function openCreate(type: CreateType) {
    setModal({ mode: "create", type });
    // 已选中上级时,预填新建弹窗的归属下拉(账号→所属站点,APIKey→所属账号)
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
  /** 新建站点:请求后端读取 origin 的 /api/status(system_name)自动补全站点名称。 */
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
  /** 新建账号:请求后端读取所属站点 origin 的 /api/user/self(username)自动补全账号名称。 */
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
  /** 编辑账号:按账号 id 自动补全用户名(userId/token 留空则用库里已存的凭据)。 */
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

  /** 弹窗表单校验:返回「字段 → 错误原因」映射,空对象表示通过。 */
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
      // 账号名称非必填(同新增):留空保持原名称,可点「自动获取」补全
      need("userId", "用户 ID 必填");
    }
    return e;
  }

  async function submitModal() {
    if (!modal || saving) return;
    // 校验不通过:高亮错误字段并提示原因,不发请求。
    const errs = validate(modal);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      // 新建成功后高亮选中新建项(含其上级);编辑保持当前选中。
      let next:
        | { site: string | null; account: string | null; key: string | null }
        | null = null;
      let syncAcct: string | null = null; // 账号创建/编辑后待拉取额度+APIKey 的账号 id
      let checkSite: string | null = null; // 站点创建/编辑后待检测连通性的站点 id
      let updatedExisting = false; // 后端 upsert 命中已有记录(更新而非新建)
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
            syncAcct = String(r.id);
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
        // 选中被编辑站点:仍在该站点路径上则保留下钻,否则重置子级
        next = sel.site === modal.id
          ? { site: modal.id, account: sel.account, key: sel.key }
          : { site: modal.id, account: null, key: null };
      } else {
        const payload: Record<string, unknown> = { userId: form.userId };
        const nm = form.name?.trim();
        if (nm) payload.name = nm; // 留空则不改,保持原名称
        if (form.accessToken) payload.accessToken = form.accessToken;
        await apiSend("PATCH", `/accounts/${modal.id}`, payload);
        syncAcct = modal.id;
        // 选中被编辑账号(连同所属站点);非当前账号则重置其下 Key
        const acc = accounts.find((a) => a.id === modal.id);
        next = {
          site: acc?.site_id ?? sel.site,
          account: modal.id,
          key: sel.account === modal.id ? sel.key : null,
        };
      }
      await load();
      if (next) setSel(next);
      setModal(null);
      showFlash(
        modal.mode === "create"
          ? (updatedExisting ? "该记录已存在，已更新" : "创建成功")
          : "已保存",
        true,
      );
      // 账号创建/编辑后立即拉取其额度与 APIKey(后台进行,不阻塞弹窗关闭)
      if (syncAcct) void syncAccountInfo(syncAcct);
      // 站点创建/编辑后自动检测连通性(后台进行)
      if (checkSite) void healthCheckSiteById(checkSite);
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "操作失败", false);
    } finally {
      setSaving(false);
    }
  }

  /** 账号创建/编辑后:并行拉取额度 + APIKey,刷新列表。best-effort,失败不影响账号本身。 */
  async function syncAccountInfo(accountId: string) {
    setBusy("acctsync" + accountId);
    try {
      const [quota, keys] = await Promise.all([
        apiSend<{ ok?: boolean }>("POST", `/accounts/${accountId}/sync-quota`)
          .catch(() => null),
        apiSend<{ ok?: boolean; count?: number }>(
          "POST",
          `/accounts/${accountId}/sync-api-keys`,
        ).catch(() => null),
      ]);
      await load();
      const keyMsg = keys?.ok
        ? `APIKey ${keys.count ?? 0} 个`
        : "APIKey 拉取失败";
      const quotaMsg = quota?.ok ? "额度已更新" : "额度同步失败";
      showFlash(`账号同步：${keyMsg} · ${quotaMsg}`, !!(keys?.ok || quota?.ok));
    } finally {
      setBusy(null);
    }
  }
  /** 站点创建/编辑后:自动检测连通性,刷新列表。best-effort。 */
  async function healthCheckSiteById(siteId: string) {
    setBusy("sitecheck" + siteId);
    try {
      const r = await apiSend<{ status?: string; httpStatus?: number }>(
        "POST",
        `/sites/${siteId}/health-check`,
      ).catch(() => null);
      await load();
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
    setOpenDd(null);
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
        {
          name,
        },
      );
      if (created?.id != null) {
        await apiSend("PATCH", `/upstream-models/${nmFor}`, {
          modelId: Number(created.id),
        });
      }
      setNmFor(null);
      await load();
      showFlash(`已创建并映射「${name}」`, true);
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "创建失败", false);
    }
  }

  return (
    <>
      <div class="page-head">
        <div>
          <h1 class="page-title">上游管理</h1>
          <p class="page-sub">
            站点 → 账号 → APIKey → 模型 · 点击下钻 · 同步按钮拉取真实数据
          </p>
        </div>
        <div class="kbar">
          {flash && (
            <span
              class={`pill ${flash.ok ? "pill-ok" : "pill-bad"}`}
              style="max-width:380px;overflow:hidden;text-overflow:ellipsis"
            >
              {flash.text}
            </span>
          )}
          {busy && <span class="meta faint">处理中…</span>}
          <button type="button" class="btn btn-ghost btn-sm" onClick={load}>
            刷新
          </button>
          <button type="button" class="btn btn-ghost btn-sm" onClick={resetAll}>
            清除筛选
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            title="安装油猴脚本,在 new-api 站点一键录入站点与账号"
            onClick={() => {
              const url = `/tuntunshu.user.js?key=${
                encodeURIComponent(getToken())
              }`;
              globalThis.open(url, "_blank");
            }}
          >
            快捷录入
          </button>
        </div>
      </div>

      <div class="miller">
        {/* 站点 */}
        <section class="mcol">
          <div class="mcol-head">
            <div class="mcol-titlebar">
              <h3>站点</h3>
              <span class="cnt">{siteRows.length}</span>
              <button
                type="button"
                class="btn btn-primary btn-sm add"
                onClick={() => openCreate("site")}
              >
                + 新建站点
              </button>
            </div>
          </div>
          <div class="mcol-search">
            <div class="search">
              <IconSearch />
              <input
                class="input"
                placeholder="筛选站点名称 / origin"
                value={qSite}
                onInput={(e) => setQSite((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="mcol-body">
            {siteRows.length
              ? siteRows.map((s) => (
                <MillerRow
                  key={s.id}
                  selected={sel.site === s.id}
                  off={!s.enabled}
                  onClick={() => pickSite(s.id)}
                >
                  <RowHead
                    name={s.name}
                    status={s.status}
                    on={s.enabled}
                    onToggle={() => toggleSite(s)}
                  />
                  <RowSub>{s.origin}</RowSub>
                  <RowActions>
                    <ActBtn
                      disabled={busy === "hc" + s.id}
                      onClick={() => healthCheck(s)}
                    >
                      {busy === "hc" + s.id ? "检测中…" : "检测"}
                    </ActBtn>
                    <ActBtn onClick={() => openEditSite(s)}>编辑</ActBtn>
                    <ActBtn danger onClick={() => delSite(s)}>删除</ActBtn>
                  </RowActions>
                </MillerRow>
              ))
              : (
                <div class="empty">
                  {loading ? "加载中…" : "暂无站点，点击「+ 新建站点」"}
                </div>
              )}
          </div>
        </section>

        {/* 账号 */}
        <section class="mcol">
          <div class="mcol-head">
            <div class="mcol-titlebar">
              <h3>账号</h3>
              <span class="cnt">{accRows.length}</span>
              <button
                type="button"
                class="btn btn-primary btn-sm add"
                onClick={() => openCreate("account")}
              >
                + 新建账号
              </button>
            </div>
          </div>
          <div class="mcol-search">
            <div class="search">
              <IconSearch />
              <input
                class="input"
                placeholder="筛选账号名称 / 用户 ID"
                value={qAcc}
                onInput={(e) => setQAcc((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="mcol-body">
            {accRows.length
              ? accRows.map((a) => {
                const q = Number(a.quota), u = Number(a.used_quota);
                const ciBusy = busy === "ci" + a.id;
                const ciLabel = ciBusy
                  ? "签到中…"
                  : a.checkin_status === "checked"
                  ? "已签到"
                  : a.checkin_status === "failed"
                  ? "签到失败"
                  : "签到";
                const ciTone: "ok" | "bad" | undefined =
                  a.checkin_status === "checked"
                    ? "ok"
                    : a.checkin_status === "failed"
                    ? "bad"
                    : undefined;
                return (
                  <MillerRow
                    key={a.id}
                    selected={sel.account === a.id}
                    off={!a.enabled}
                    onClick={() => pickAccount(a.id)}
                  >
                    <RowHead
                      name={a.name}
                      status={a.status}
                      on={a.enabled}
                      onToggle={() => toggleAcc(a)}
                    />
                    <RowSub>
                      {a.user_id} · 余 ${usd(String(q - u)).toFixed(2)} / $
                      {usd(a.quota).toFixed(2)}
                    </RowSub>
                    <RowActions>
                      <ActBtn
                        tone={ciTone}
                        title={checkinMsg[a.id] || undefined}
                        disabled={ciBusy}
                        onClick={() => checkin(a)}
                      >
                        {ciLabel}
                      </ActBtn>
                      <ActBtn
                        disabled={busy === "sk" + a.id}
                        onClick={() => syncKeys(a)}
                      >
                        {busy === "sk" + a.id ? "拉取中…" : "拉Key"}
                      </ActBtn>
                      <ActBtn onClick={() => openEditAccount(a)}>编辑</ActBtn>
                      <ActBtn danger onClick={() => delAcc(a)}>删除</ActBtn>
                    </RowActions>
                  </MillerRow>
                );
              })
              : (
                <div class="empty">
                  {sel.site != null
                    ? "该站点下暂无账号"
                    : "选择站点下钻，或浏览全部"}
                </div>
              )}
          </div>
        </section>

        {/* APIKey */}
        <section class="mcol">
          <div class="mcol-head">
            <div class="mcol-titlebar">
              <h3>APIKey</h3>
              <span class="cnt">{keyRows.length}</span>
              <button
                type="button"
                class="btn btn-primary btn-sm add"
                onClick={() => openCreate("apikey")}
              >
                + 新建 Key
              </button>
            </div>
          </div>
          <div class="mcol-search">
            <div class="search">
              <IconSearch />
              <input
                class="input"
                placeholder="筛选 Key 名称"
                value={qKey}
                onInput={(e) => setQKey((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="mcol-body">
            {keyRows.length
              ? keyRows.map((k) => (
                <MillerRow
                  key={k.id}
                  selected={sel.key === k.id}
                  off={!k.enabled}
                  onClick={() => pickKey(k.id)}
                >
                  <RowHead
                    name={k.name}
                    status={k.status}
                    on={k.enabled}
                    onToggle={() => toggleKey(k)}
                  />
                  <RowSub>{maskKey(k.key)}</RowSub>
                  <RowActions>
                    <ActBtn
                      disabled={busy === "sm" + k.id}
                      onClick={() => syncModels(k)}
                    >
                      {busy === "sm" + k.id ? "拉取中…" : "拉取模型"}
                    </ActBtn>
                    <ActBtn danger onClick={() => delKey(k)}>删除</ActBtn>
                  </RowActions>
                </MillerRow>
              ))
              : (
                <div class="empty">
                  {sel.account != null
                    ? "该账号下暂无 Key"
                    : "选择账号下钻，或浏览全部"}
                </div>
              )}
          </div>
        </section>

        {/* 模型 */}
        <section class="mcol">
          <div class="mcol-head">
            <div class="mcol-titlebar">
              <h3>模型</h3>
              <span class="cnt">{modRows.length}</span>
            </div>
          </div>
          <div class="mcol-search">
            <div class="search">
              <IconSearch />
              <input
                class="input"
                placeholder="筛选模型名称"
                value={qMod}
                onInput={(e) => setQMod((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div class="mcol-body">
            {modRows.length
              ? modRows.map((m) => {
                const mapped = m.model_id
                  ? models.find((x) => x.id === m.model_id)?.name ?? null
                  : null;
                return (
                  <MillerRow key={m.id} leaf off={!m.enabled}>
                    <RowHead
                      name={m.name}
                      status={m.status}
                      on={m.enabled}
                      onToggle={() => toggleUm(m)}
                    />
                    <div class={`dd${openDd === m.id ? " open" : ""}`}>
                      <button
                        type="button"
                        class={`dd-btn${mapped ? "" : " unmapped"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDdFilter("");
                          setOpenDd((cur) => cur === m.id ? null : m.id);
                        }}
                      >
                        <span class="cur">
                          {mapped ? "→ " + mapped : "未映射 · 点击选择"}
                        </span>
                        <span class="caret">▾</span>
                      </button>
                      <div class="dd-pop" onClick={(e) => e.stopPropagation()}>
                        <div class="dd-search">
                          <input
                            placeholder="搜索统一模型"
                            value={ddFilter}
                            onInput={(e) =>
                              setDdFilter((e.target as HTMLInputElement).value)}
                          />
                        </div>
                        <div class="dd-list">
                          <div
                            class={`dd-item${mapped ? "" : " sel"}`}
                            style="color:var(--muted)"
                            onClick={() => setMap(m.id, null)}
                          >
                            清除映射（无映射）
                          </div>
                          {ddItems.map((mod) => (
                            <div
                              key={mod.id}
                              class={`dd-item${
                                m.model_id === mod.id ? " sel" : ""
                              }`}
                              onClick={() => setMap(m.id, mod.id)}
                            >
                              {mod.name}
                              {m.model_id === mod.id && (
                                <span class="check">✓</span>
                              )}
                            </div>
                          ))}
                        </div>
                        <div class="dd-foot">
                          <button
                            type="button"
                            onClick={() => openNewModel(m.id)}
                          >
                            ＋ 新增统一模型
                          </button>
                        </div>
                      </div>
                    </div>
                  </MillerRow>
                );
              })
              : (
                <div class="empty">
                  {sel.key != null
                    ? "该 Key 下暂无模型，先在账号列「拉Key」再在此列「拉取模型」"
                    : "选择 APIKey 下钻，或浏览全部"}
                </div>
              )}
          </div>
        </section>
      </div>

      {/* 创建 / 编辑弹窗 */}
      <Modal open={modal !== null} onClose={() => setModal(null)}>
        {modal && (
          <>
            <div class="modal-head">
              <h3>
                {modal.mode === "create" ? "新建" : "编辑"}
                {modal.type === "site"
                  ? "站点"
                  : modal.type === "account"
                  ? "账号"
                  : " APIKey"}
              </h3>
              <button
                type="button"
                class="icon-btn"
                onClick={() => setModal(null)}
                aria-label="关闭"
              >
                <IconClose />
              </button>
            </div>
            <div class="modal-body">
              {modal.type === "site" && (
                <>
                  <Field
                    label="Origin"
                    hint="例如 https://anyrouter.top"
                    k="origin"
                    form={form}
                    error={errors.origin}
                    update={updateField}
                  />
                  <div class="field">
                    <label>
                      {modal.mode === "create"
                        ? "站点名称（可留空，自动取站点名称）"
                        : "站点名称"}
                    </label>
                    <div class="token-row">
                      <input
                        class={`input${errors.name ? " input-err" : ""}`}
                        placeholder="留空将自动获取站点名称"
                        value={form.name ?? ""}
                        onInput={(e) =>
                          updateField(
                            "name",
                            (e.target as HTMLInputElement).value,
                          )}
                      />
                      <button
                        type="button"
                        class="btn btn-sm"
                        disabled={probing}
                        onClick={probeTitle}
                      >
                        {probing ? "获取中…" : "自动获取"}
                      </button>
                    </div>
                    {errors.name && (
                      <span class="field-err">{errors.name}</span>
                    )}
                    <span class="hint">
                      基于 Origin 的 /api/status（system_name）自动补全
                    </span>
                  </div>
                  <Field
                    label="备注（可选）"
                    hint=""
                    k="remark"
                    form={form}
                    update={updateField}
                  />
                </>
              )}
              {modal.type === "account" && (
                <>
                  {modal.mode === "create" && (
                    <div class="field">
                      <label>所属站点</label>
                      <select
                        class={`select${errors.siteId ? " input-err" : ""}`}
                        value={form.siteId ?? ""}
                        onChange={(e) =>
                          updateField(
                            "siteId",
                            (e.target as HTMLSelectElement).value,
                          )}
                      >
                        <option value="">选择站点…</option>
                        {sites.map((s) => (
                          <option value={s.id} key={s.id}>{s.name}</option>
                        ))}
                      </select>
                      {errors.siteId && (
                        <span class="field-err">{errors.siteId}</span>
                      )}
                    </div>
                  )}
                  <Field
                    label="用户 ID"
                    hint="new-api userId"
                    k="userId"
                    form={form}
                    error={errors.userId}
                    update={updateField}
                  />
                  <Field
                    label="AccessToken"
                    hint="粘贴登录令牌"
                    k="accessToken"
                    type="password"
                    form={form}
                    error={errors.accessToken}
                    update={updateField}
                  />
                  <div class="field">
                    <label>账号名称（可留空，自动获取）</label>
                    <div class="token-row">
                      <input
                        class={`input${errors.name ? " input-err" : ""}`}
                        placeholder={modal.mode === "create"
                          ? "留空将自动获取用户名"
                          : "留空则保持原名称"}
                        value={form.name ?? ""}
                        onInput={(e) =>
                          updateField(
                            "name",
                            (e.target as HTMLInputElement).value,
                          )}
                      />
                      <button
                        type="button"
                        class="btn btn-sm"
                        disabled={probing}
                        onClick={() =>
                          modal.mode === "create"
                            ? probeUsername()
                            : probeUsernameEdit(modal.id)}
                      >
                        {probing ? "获取中…" : "自动获取"}
                      </button>
                    </div>
                    {errors.name && (
                      <span class="field-err">{errors.name}</span>
                    )}
                    <span class="hint">
                      基于所属站点的 /api/user/self（username）自动补全
                    </span>
                  </div>
                </>
              )}
              {modal.type === "apikey" && (
                <>
                  <div class="field">
                    <label>所属账号</label>
                    <select
                      class={`select${errors.accountId ? " input-err" : ""}`}
                      value={form.accountId ?? ""}
                      onChange={(e) =>
                        updateField(
                          "accountId",
                          (e.target as HTMLSelectElement).value,
                        )}
                    >
                      <option value="">选择账号…</option>
                      {accounts.map((a) => (
                        <option value={a.id} key={a.id}>
                          {siteName(a.site_id)} / {a.name}
                        </option>
                      ))}
                    </select>
                    {errors.accountId && (
                      <span class="field-err">{errors.accountId}</span>
                    )}
                  </div>
                  <Field
                    label="Key 名称"
                    hint="例如 default"
                    k="name"
                    form={form}
                    error={errors.name}
                    update={updateField}
                  />
                  <Field
                    label="Key"
                    hint="sk-..."
                    k="key"
                    form={form}
                    error={errors.key}
                    update={updateField}
                  />
                </>
              )}
            </div>
            <div class="modal-foot">
              <button
                type="button"
                class="btn"
                disabled={saving}
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                class="btn btn-primary"
                disabled={saving}
                onClick={submitModal}
              >
                {saving && <span class="btn-spinner"></span>}
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* 新增统一模型弹窗 */}
      <Modal open={nmFor !== null} onClose={() => setNmFor(null)}>
        {nmFor !== null && (
          <>
            <div class="modal-head">
              <h3>新增统一模型</h3>
              <button
                type="button"
                class="icon-btn"
                onClick={() => setNmFor(null)}
                aria-label="关闭"
              >
                <IconClose />
              </button>
            </div>
            <div class="modal-body">
              <p class="page-sub" style="margin:0">
                新增的统一模型会出现在「模型管理」中，并立即作为当前上游模型的映射目标。
              </p>
              <div class="field">
                <label>模型名称（对外）</label>
                <input
                  class="input"
                  placeholder="例如 deepseek-chat"
                  value={nmName}
                  autofocus
                  onInput={(e) =>
                    setNmName((e.target as HTMLInputElement).value)}
                />
              </div>
            </div>
            <div class="modal-foot">
              <button type="button" class="btn" onClick={() => setNmFor(null)}>
                取消
              </button>
              <button
                type="button"
                class="btn btn-primary"
                onClick={saveNewModel}
              >
                创建并映射
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function Field(
  { label, hint, k, form, error, type, update }: {
    label: string;
    hint: string;
    k: string;
    form: Record<string, string>;
    error?: string;
    type?: string;
    update: (k: string, v: string) => void;
  },
): JSX.Element {
  return (
    <div class="field">
      <label>{label}</label>
      <input
        class={`input${error ? " input-err" : ""}`}
        type={type ?? "text"}
        placeholder={hint}
        value={form[k] ?? ""}
        onInput={(e) => update(k, (e.target as HTMLInputElement).value)}
      />
      {error && <span class="field-err">{error}</span>}
    </div>
  );
}
