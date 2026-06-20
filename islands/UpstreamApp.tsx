import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import { IconClose, IconSearch } from "../components/icons.tsx";
import { apiGet, apiSend } from "../components/admin_api.ts";

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

  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

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

  // 账号 / APIKey 列表只有一项时自动选中(基于上级过滤,忽略搜索框)
  useEffect(() => {
    const list = sel.site == null
      ? accounts
      : accounts.filter((a) => a.site_id === sel.site);
    if (list.length === 1) {
      setSel((p) =>
        p.account == null ? { ...p, account: list[0].id, key: null } : p
      );
    }
  }, [accounts, sel.site]);
  useEffect(() => {
    const list = sel.account == null
      ? keys
      : keys.filter((k) => k.account_id === sel.account);
    if (list.length === 1) {
      setSel((p) => p.key == null ? { ...p, key: list[0].id } : p);
    }
  }, [keys, sel.account]);

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

  const siteRows = sites.filter((s) => hit(s.name + " " + s.origin, qSite));
  const accRows = accounts.filter((a) =>
    (sel.site == null || a.site_id === sel.site) &&
    hit(a.name + " " + a.user_id, qAcc)
  );
  const keyRows = keys.filter((k) =>
    (sel.account == null || k.account_id === sel.account) &&
    hit(k.name + " " + k.key, qKey)
  );
  const modRows = ums.filter((m) => {
    const mapped = m.model_id
      ? models.find((x) => x.id === m.model_id)?.name ?? ""
      : "";
    return (sel.key == null || m.api_key_id === sel.key) &&
      hit(m.name + " " + mapped, qMod);
  });
  const ddItems = models.filter((m) => hit(m.name, ddFilter));

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
      return `「${a.name}」签到：${
        CHECKIN_MAP[r.checkinStatus ?? "unknown"]?.[1] ?? r.checkinStatus ??
          r.error ?? "?"
      }`;
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
    setForm({});
  }
  function openEditSite(s: Site) {
    setModal({ mode: "edit", type: "site", id: s.id });
    setForm({ name: s.name, origin: s.origin, remark: s.remark ?? "" });
  }
  function openEditAccount(a: Account) {
    setModal({ mode: "edit", type: "account", id: a.id });
    setForm({ name: a.name, userId: a.user_id, accessToken: "" });
  }
  async function submitModal() {
    if (!modal) return;
    try {
      if (modal.mode === "create") {
        if (modal.type === "site") {
          if (!form.name || !form.origin) return;
          await apiSend("POST", "/sites", {
            name: form.name,
            origin: form.origin,
            remark: form.remark || null,
          });
        } else if (modal.type === "account") {
          if (!form.siteId || !form.name || !form.userId || !form.accessToken) {
            return;
          }
          await apiSend("POST", "/accounts", {
            siteId: Number(form.siteId),
            name: form.name,
            userId: form.userId,
            accessToken: form.accessToken,
          });
        } else {
          if (!form.accountId || !form.name || !form.key) return;
          await apiSend("POST", "/api-keys", {
            accountId: Number(form.accountId),
            name: form.name,
            key: form.key,
          });
        }
      } else if (modal.type === "site") {
        if (!form.name || !form.origin) return;
        await apiSend("PATCH", `/sites/${modal.id}`, {
          name: form.name,
          origin: form.origin,
          remark: form.remark || null,
        });
      } else {
        if (!form.name || !form.userId) return;
        const payload: Record<string, unknown> = {
          name: form.name,
          userId: form.userId,
        };
        if (form.accessToken) payload.accessToken = form.accessToken;
        await apiSend("PATCH", `/accounts/${modal.id}`, payload);
      }
      setModal(null);
      await load();
      showFlash(modal.mode === "create" ? "创建成功" : "已保存", true);
    } catch (e) {
      showFlash(e instanceof Error ? e.message : "操作失败", false);
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
      {modal && (
        <div
          class="modal-mask on"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div class="modal-card" role="dialog" aria-modal="true">
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
                    label="站点名称"
                    hint="例如 AnyRouter"
                    k="name"
                    form={form}
                    setForm={setForm}
                  />
                  <Field
                    label="Origin"
                    hint="例如 https://anyrouter.top"
                    k="origin"
                    form={form}
                    setForm={setForm}
                  />
                  <Field
                    label="备注（可选）"
                    hint=""
                    k="remark"
                    form={form}
                    setForm={setForm}
                  />
                </>
              )}
              {modal.type === "account" && (
                <>
                  {modal.mode === "create" && (
                    <div class="field">
                      <label>所属站点</label>
                      <select
                        class="select"
                        value={form.siteId ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            siteId: (e.target as HTMLSelectElement).value,
                          }))}
                      >
                        <option value="">选择站点…</option>
                        {sites.map((s) => (
                          <option value={s.id} key={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <Field
                    label="账号名称"
                    hint="例如 主账号"
                    k="name"
                    form={form}
                    setForm={setForm}
                  />
                  <Field
                    label="用户 ID"
                    hint="new-api userId"
                    k="userId"
                    form={form}
                    setForm={setForm}
                  />
                  <Field
                    label={modal.mode === "edit"
                      ? "AccessToken（留空不修改）"
                      : "AccessToken"}
                    hint={modal.mode === "edit"
                      ? "仅在令牌失效时重新粘贴"
                      : "粘贴登录令牌"}
                    k="accessToken"
                    form={form}
                    setForm={setForm}
                  />
                </>
              )}
              {modal.type === "apikey" && (
                <>
                  <div class="field">
                    <label>所属账号</label>
                    <select
                      class="select"
                      value={form.accountId ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          accountId: (e.target as HTMLSelectElement).value,
                        }))}
                    >
                      <option value="">选择账号…</option>
                      {accounts.map((a) => (
                        <option value={a.id} key={a.id}>
                          {siteName(a.site_id)} / {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Field
                    label="Key 名称"
                    hint="例如 default"
                    k="name"
                    form={form}
                    setForm={setForm}
                  />
                  <Field
                    label="Key"
                    hint="sk-..."
                    k="key"
                    form={form}
                    setForm={setForm}
                  />
                </>
              )}
            </div>
            <div class="modal-foot">
              <button
                type="button"
                class="btn"
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                class="btn btn-primary"
                onClick={submitModal}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增统一模型弹窗 */}
      {nmFor !== null && (
        <div
          class="modal-mask on"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNmFor(null);
          }}
        >
          <div class="modal-card" role="dialog" aria-modal="true">
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
          </div>
        </div>
      )}
    </>
  );
}

function Field(
  { label, hint, k, form, setForm }: {
    label: string;
    hint: string;
    k: string;
    form: Record<string, string>;
    setForm: (
      fn: (f: Record<string, string>) => Record<string, string>,
    ) => void;
  },
): JSX.Element {
  return (
    <div class="field">
      <label>{label}</label>
      <input
        class="input"
        placeholder={hint}
        value={form[k] ?? ""}
        onInput={(e) =>
          setForm((f) => ({ ...f, [k]: (e.target as HTMLInputElement).value }))}
      />
    </div>
  );
}
