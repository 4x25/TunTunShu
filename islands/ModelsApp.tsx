import { useEffect, useState } from "preact/hooks";
import { IconClose } from "../components/icons.tsx";
import { Modal } from "../components/Modal.tsx";
import {
  apiGet,
  apiSend,
  fetchAllPages,
  getToken,
} from "../components/admin_api.ts";

interface Model {
  id: string;
  name: string;
  enabled: boolean;
  upstream_model_count: number;
  healthy_upstream_model_count: number;
}
interface UpstreamModel {
  id: string;
  api_key_id: string;
  model_id: string | null;
  name: string;
  enabled: boolean;
  status: string;
}
interface NamedRow {
  id: string;
  name: string;
  account_id?: string;
  site_id?: string;
}

function StatePill({ on }: { on: boolean }) {
  return on
    ? (
      <span class="pill pill-ok">
        <span class="dot"></span>启用
      </span>
    )
    : (
      <span class="pill pill-mute">
        <span class="dot"></span>停用
      </span>
    );
}

export default function ModelsApp() {
  const [models, setModels] = useState<Model[]>([]);
  const [ums, setUms] = useState<UpstreamModel[]>([]);
  const [keys, setKeys] = useState<NamedRow[]>([]);
  const [accounts, setAccounts] = useState<NamedRow[]>([]);
  const [sites, setSites] = useState<NamedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | "on" | "off">("all");

  const [editId, setEditId] = useState<string | null | "new">(null);
  const [mName, setMName] = useState("");
  const [mOn, setMOn] = useState(true);
  const [busy, setBusy] = useState<"" | "save" | "del">("");

  const [chanId, setChanId] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<
    { testing: boolean; ok?: boolean; ms?: number; err?: string } | null
  >(null);

  async function load() {
    setLoading(true);
    try {
      const [m, u, k, a, s] = await Promise.all([
        apiGet<Model[]>("/models"),
        fetchAllPages<UpstreamModel>("/upstream-models"),
        fetchAllPages<NamedRow>("/api-keys"),
        fetchAllPages<NamedRow>("/accounts"),
        fetchAllPages<NamedRow>("/sites"),
      ]);
      setModels(m);
      setUms(u);
      setKeys(k);
      setAccounts(a);
      setSites(s);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function sourceLabel(um: UpstreamModel): string {
    const key = keys.find((x) => x.id === um.api_key_id);
    const acc = key && accounts.find((x) => x.id === key.account_id);
    const site = acc && sites.find((x) => x.id === acc.site_id);
    return [site?.name, acc?.name].filter(Boolean).join(" / ") +
      (key ? ` · ${key.name}` : "");
  }

  const rows = models.filter((m) => {
    if (f === "on" && !m.enabled) return false;
    if (f === "off" && m.enabled) return false;
    return m.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0;
  });
  const totalChan = models.reduce((a, m) => a + m.upstream_model_count, 0);
  const healthyChan = models.reduce(
    (a, m) => a + m.healthy_upstream_model_count,
    0,
  );

  async function toggle(m: Model) {
    setModels((prev) =>
      prev.map((x) => x.id === m.id ? { ...x, enabled: !x.enabled } : x)
    );
    await apiSend("PATCH", `/models/${m.id}`, { enabled: !m.enabled });
  }

  function openEdit(m: Model | null) {
    if (m) {
      setEditId(m.id);
      setMName(m.name);
      setMOn(m.enabled);
    } else {
      setEditId("new");
      setMName("");
      setMOn(true);
    }
  }
  async function saveEdit() {
    const name = mName.trim();
    if (!name || busy) return;
    setBusy("save");
    try {
      if (editId === "new") {
        await apiSend("POST", "/models", { name });
      } else if (editId) {
        await apiSend("PATCH", `/models/${editId}`, { name, enabled: mOn });
      }
      setEditId(null);
      await load();
    } finally {
      setBusy("");
    }
  }
  async function removeModel() {
    if (!editId || editId === "new" || busy) return;
    setBusy("del");
    try {
      await apiSend("DELETE", `/models/${editId}`);
      setEditId(null);
      await load();
    } finally {
      setBusy("");
    }
  }

  async function unmap(um: UpstreamModel) {
    await apiSend("PATCH", `/upstream-models/${um.id}`, { modelId: null });
    await load();
  }
  async function toggleUm(um: UpstreamModel) {
    setUms((prev) =>
      prev.map((x) => x.id === um.id ? { ...x, enabled: !x.enabled } : x)
    );
    await apiSend("PATCH", `/upstream-models/${um.id}`, {
      enabled: !um.enabled,
    });
  }

  async function testModel(name: string) {
    setTestOut({ testing: true });
    const started = Date.now();
    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: name,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });
      const ms = Date.now() - started;
      if (res.ok) {
        setTestOut({ testing: false, ok: true, ms });
      } else {
        const body = await res.json().catch(() => ({})) as {
          error?: { message?: string };
        };
        setTestOut({
          testing: false,
          ok: false,
          err: `${res.status} ${body.error?.message ?? ""}`.slice(0, 80),
        });
      }
    } catch (e) {
      setTestOut({
        testing: false,
        ok: false,
        err: e instanceof Error ? e.message : "error",
      });
    }
  }

  const editModel = editId && editId !== "new"
    ? models.find((m) => m.id === editId)
    : null;
  const chanModel = chanId ? models.find((m) => m.id === chanId) : null;
  const chanUms = chanId ? ums.filter((u) => u.model_id === chanId) : [];

  return (
    <>
      <div class="page-head">
        <div>
          <h1 class="page-title">模型管理</h1>
          <p class="page-sub">对外暴露的统一模型名 · 由上游通道聚合提供</p>
        </div>
        <div class="kbar">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={loading}
            onClick={load}
          >
            {loading && <span class="btn-spinner"></span>}
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>

      <section class="stat-grid" style="margin-bottom:16px">
        <div class="stat-tile">
          <span class="k">模型总数</span>
          <span class="v">{models.length}</span>
        </div>
        <div class="stat-tile">
          <span class="k">已启用</span>
          <span class="v">{models.filter((m) => m.enabled).length}</span>
        </div>
        <div class="stat-tile">
          <span class="k">关联上游通道</span>
          <span class="v">{totalChan}</span>
        </div>
        <div class="stat-tile">
          <span class="k">健康通道</span>
          <span class="v" style="color:var(--ok)">{healthyChan}</span>
        </div>
      </section>

      <div class="toolbar">
        <div class="search">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width={2}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            class="input"
            placeholder="搜索模型名称"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="segmented">
          {(["all", "on", "off"] as const).map((k) => (
            <button
              type="button"
              key={k}
              class={f === k ? "active" : undefined}
              onClick={() => setF(k)}
            >
              {k === "all" ? "全部" : k === "on" ? "启用" : "停用"}
            </button>
          ))}
        </div>
        <button
          type="button"
          class="btn btn-primary ml-auto"
          onClick={() => openEdit(null)}
        >
          + 新建模型
        </button>
      </div>

      <section class="card">
        <div class="table-wrap">
          <table class="dtable">
            <thead>
              <tr>
                <th style="width:34px"></th>
                <th>模型名称</th>
                <th class="num">可用通道</th>
                <th>状态</th>
                <th style="text-align:right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length
                ? rows.map((m) => {
                  const pct = m.upstream_model_count
                    ? Math.round(
                      m.healthy_upstream_model_count / m.upstream_model_count *
                        100,
                    )
                    : 0;
                  const chanColor = m.healthy_upstream_model_count === 0
                    ? "var(--bad)"
                    : m.healthy_upstream_model_count < m.upstream_model_count
                    ? "var(--warn)"
                    : "var(--ok)";
                  return (
                    <tr key={m.id}>
                      <td>
                        <label class="switch">
                          <input
                            type="checkbox"
                            checked={m.enabled}
                            onChange={() => toggle(m)}
                          />
                          <span class="track"></span>
                        </label>
                      </td>
                      <td class="primary-cell">{m.name}</td>
                      <td class="num">
                        <span class="chan-bar">
                          <span class="bar">
                            <span
                              style={`width:${pct}%;background:${chanColor}`}
                            >
                            </span>
                          </span>
                          {m.healthy_upstream_model_count}/{m
                            .upstream_model_count}
                        </span>
                      </td>
                      <td>
                        <StatePill on={m.enabled} />
                      </td>
                      <td>
                        <div class="actions-cell">
                          <button
                            type="button"
                            class="btn btn-ghost btn-sm"
                            onClick={() => openEdit(m)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-sm"
                            onClick={() => {
                              setChanId(m.id);
                              setTestOut(null);
                            }}
                          >
                            通道{" "}
                            <span class="tag" style="margin-left:4px">
                              {m.upstream_model_count}
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
                : (
                  <tr>
                    <td
                      colspan={5}
                      style="text-align:center;color:var(--faint);padding:28px"
                    >
                      {loading ? "加载中…" : "暂无模型，点击右上「新建模型」"}
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 新建 / 编辑 弹窗 */}
      <Modal open={editId !== null} onClose={() => setEditId(null)}>
        {editId !== null && (
          <>
            <div class="modal-head">
              <h3>
                {editId === "new" ? "新建模型" : "编辑模型 · " + mName}
              </h3>
              <button
                type="button"
                class="icon-btn"
                onClick={() => setEditId(null)}
                aria-label="关闭"
              >
                <IconClose />
              </button>
            </div>
            <div class="modal-body">
              <div class="field">
                <label>模型名称（对外）</label>
                <input
                  class="input"
                  placeholder="例如 gpt-4o"
                  value={mName}
                  autofocus
                  onInput={(e) =>
                    setMName((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="field">
                <label style="display:flex;align-items:center;gap:9px">
                  <label class="switch">
                    <input
                      type="checkbox"
                      checked={mOn}
                      onChange={(e) =>
                        setMOn((e.target as HTMLInputElement).checked)}
                    />
                    <span class="track"></span>
                  </label>
                  启用该模型
                </label>
              </div>
              {editModel && (
                <div class="page-sub">
                  当前关联 {editModel.upstream_model_count} 条上游通道，其中
                  {" "}
                  {editModel.healthy_upstream_model_count} 条健康。
                </div>
              )}
            </div>
            <div class="modal-foot">
              {editId !== "new" && (
                <button
                  type="button"
                  class="btn"
                  style="margin-right:auto;color:var(--bad);border-color:color-mix(in oklch,var(--bad) 40%,transparent)"
                  disabled={!!busy}
                  onClick={removeModel}
                >
                  {busy === "del" && <span class="btn-spinner"></span>}
                  {busy === "del" ? "删除中…" : "删除"}
                </button>
              )}
              <button
                type="button"
                class="btn"
                disabled={!!busy}
                onClick={() => setEditId(null)}
              >
                取消
              </button>
              <button
                type="button"
                class="btn btn-primary"
                disabled={!!busy}
                onClick={saveEdit}
              >
                {busy === "save" && <span class="btn-spinner"></span>}
                {busy === "save" ? "保存中…" : "保存"}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* 通道弹窗 */}
      <Modal open={chanId !== null} onClose={() => setChanId(null)} wide>
        {chanModel && (
          <>
            <div class="modal-head">
              <h3>通道 · {chanModel.name}</h3>
              <button
                type="button"
                class="icon-btn"
                onClick={() => setChanId(null)}
                aria-label="关闭"
              >
                <IconClose />
              </button>
            </div>
            <div class="modal-body">
              {chanUms.length
                ? chanUms.map((um) => (
                  <div class="chan-row" key={um.id}>
                    <div class="src">
                      <div class="nm">{um.name}</div>
                      <div class="pa">{sourceLabel(um)}</div>
                    </div>
                    <div>
                      {um.status === "healthy"
                        ? (
                          <span class="pill pill-ok">
                            <span class="dot"></span>健康
                          </span>
                        )
                        : um.status === "invalid"
                        ? (
                          <span class="pill pill-bad">
                            <span class="dot"></span>失效
                          </span>
                        )
                        : (
                          <span class="pill pill-mute">
                            <span class="dot"></span>未知
                          </span>
                        )}
                    </div>
                    <div>
                      <button
                        type="button"
                        class="btn btn-sm"
                        onClick={() => unmap(um)}
                      >
                        解除映射
                      </button>
                    </div>
                    <div>
                      <label class="switch">
                        <input
                          type="checkbox"
                          checked={um.enabled}
                          onChange={() => toggleUm(um)}
                        />
                        <span class="track"></span>
                      </label>
                    </div>
                  </div>
                ))
                : (
                  <div
                    class="empty"
                    style="padding:24px;text-align:center;color:var(--faint)"
                  >
                    该模型暂无上游通道，请在「上游管理」中为某个 APIKey
                    的模型映射到本模型。
                  </div>
                )}
            </div>
            <div class="modal-foot">
              <span class="meta faint" style="margin-right:auto">
                {chanUms.length
                  ? `${
                    chanUms.filter((u) => u.status === "healthy").length
                  } / ${chanUms.length} 健康`
                  : ""}
              </span>
              <span class="test-out" style="margin-right:8px">
                {testOut?.testing
                  ? <span class="muted">测试中…</span>
                  : testOut?.ok
                  ? <span style="color:var(--ok)">✓ {testOut.ms}ms</span>
                  : testOut
                  ? <span style="color:var(--bad)">✗ {testOut.err}</span>
                  : null}
              </span>
              <button
                type="button"
                class="btn"
                onClick={() => testModel(chanModel.name)}
              >
                测试该模型
              </button>
              <button
                type="button"
                class="btn btn-primary"
                onClick={() => setChanId(null)}
              >
                关闭
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
