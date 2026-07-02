import { EndpointIcon } from "../brand_icons.tsx";
import { IconSearch } from "../icons.tsx";
import { ENDPOINT_LABELS, ENDPOINT_OPTIONS, TEST_KINDS } from "./constants.ts";
import { handleColumnScroll } from "./list_state.ts";
import { ActBtn, MillerRow, RowActions, RowHead } from "./row_primitives.tsx";
import type { ListPage, Model, TestKind, UpstreamModel } from "./types.ts";

export function UpstreamModelColumn(
  {
    page,
    rows,
    q,
    selectedKeyId,
    models,
    ddItems,
    ddFilter,
    openDd,
    openEp,
    busy,
    onKeywordChange,
    onLoadMore,
    onToggle,
    onEndpointMenuToggle,
    onMapMenuToggle,
    onDdFilterChange,
    onEndpointSelect,
    onMap,
    onOpenNewModel,
    onRunTest,
  }: {
    page: ListPage<UpstreamModel>;
    rows: UpstreamModel[];
    q: string;
    selectedKeyId: string | null;
    models: Model[];
    ddItems: Model[];
    ddFilter: string;
    openDd: string | null;
    openEp: string | null;
    busy: string | null;
    onKeywordChange: (value: string) => void;
    onLoadMore: () => void;
    onToggle: (model: UpstreamModel) => void;
    onEndpointMenuToggle: (id: string) => void;
    onMapMenuToggle: (id: string) => void;
    onDdFilterChange: (value: string) => void;
    onEndpointSelect: (model: UpstreamModel, endpoint: string) => void;
    onMap: (upstreamModelId: string, modelId: string | null) => void;
    onOpenNewModel: (upstreamModelId: string) => void;
    onRunTest: (model: UpstreamModel, kind: TestKind) => void;
  },
) {
  return (
    <section class="mcol">
      <div class="mcol-head">
        <div class="mcol-titlebar">
          <h3>模型</h3>
          <span class="cnt">{rows.length} / {page.totalCount}</span>
          {page.refreshing && rows.length > 0 && (
            <span class="meta faint">刷新中…</span>
          )}
        </div>
      </div>
      <div class="mcol-search">
        <div class="search">
          <IconSearch />
          <input
            class="input"
            placeholder="筛选模型名称"
            value={q}
            onInput={(e) =>
              onKeywordChange((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div
        class="mcol-body"
        onScroll={(e) => handleColumnScroll(e, page, onLoadMore)}
      >
        {rows.length
          ? rows.map((m) => {
            const mapped = m.model_id
              ? models.find((x) => x.id === m.model_id)?.name ?? null
              : null;
            return (
              <MillerRow key={m.id} leaf off={!m.enabled}>
                <RowHead
                  name={m.name}
                  status={m.status}
                  on={m.enabled}
                  onToggle={() => onToggle(m)}
                  leading={
                    <div
                      class={`dd ep-dd${openEp === m.id ? " open" : ""}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        class="ep-btn"
                        title={`协议:${
                          ENDPOINT_LABELS[m.endpoint_type] ?? m.endpoint_type
                        }(点击切换)`}
                        disabled={busy === "ep" + m.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEndpointMenuToggle(m.id);
                        }}
                      >
                        {busy === "ep" + m.id
                          ? <span class="btn-spinner"></span>
                          : (
                            <EndpointIcon
                              type={m.endpoint_type}
                              class="brand-ico"
                            />
                          )}
                      </button>
                      <div class="dd-pop">
                        <div class="dd-hint">选择上游该模型支持的协议类型</div>
                        <div class="dd-list">
                          {ENDPOINT_OPTIONS.map((ep) => (
                            <div
                              key={ep}
                              class={`dd-item${
                                m.endpoint_type === ep ? " sel" : ""
                              }`}
                              onClick={() => onEndpointSelect(m, ep)}
                            >
                              <EndpointIcon type={ep} class="brand-ico" />
                              {ENDPOINT_LABELS[ep]}
                              {m.endpoint_type === ep && (
                                <span class="check">✓</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  }
                />
                <div class={`dd${openDd === m.id ? " open" : ""}`}>
                  <button
                    type="button"
                    class={`dd-btn${mapped ? "" : " unmapped"}`}
                    disabled={busy === "map" + m.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMapMenuToggle(m.id);
                    }}
                  >
                    <span class="cur">
                      {busy === "map" + m.id
                        ? "切换中…"
                        : (mapped ? "→ " + mapped : "未映射 · 点击选择")}
                    </span>
                    {busy === "map" + m.id
                      ? <span class="btn-spinner"></span>
                      : <span class="caret">▾</span>}
                  </button>
                  <div class="dd-pop" onClick={(e) => e.stopPropagation()}>
                    <div class="dd-search">
                      <input
                        placeholder="搜索统一模型"
                        value={ddFilter}
                        onInput={(e) =>
                          onDdFilterChange(
                            (e.target as HTMLInputElement).value,
                          )}
                      />
                    </div>
                    <div class="dd-list">
                      <div
                        class={`dd-item${mapped ? "" : " sel"}`}
                        style="color:var(--muted)"
                        onClick={() => onMap(m.id, null)}
                      >
                        清除映射（无映射）
                      </div>
                      {ddItems.map((mod) => (
                        <div
                          key={mod.id}
                          class={`dd-item${
                            m.model_id === mod.id ? " sel" : ""
                          }`}
                          onClick={() => onMap(m.id, mod.id)}
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
                        onClick={() => onOpenNewModel(m.id)}
                      >
                        ＋ 新增统一模型
                      </button>
                    </div>
                  </div>
                </div>
                <RowActions>
                  {TEST_KINDS.map((t) => (
                    <ActBtn
                      key={t.kind}
                      disabled={busy === "ep" + m.id}
                      onClick={() => onRunTest(m, t.kind)}
                    >
                      {t.label}
                    </ActBtn>
                  ))}
                </RowActions>
              </MillerRow>
            );
          })
          : (
            <div class="empty">
              {page.loading ? "加载中…" : page.error ??
                (selectedKeyId != null
                  ? "该 Key 下暂无模型，先在账号列「拉Key」再在此列「拉取模型」"
                  : "选择 APIKey 下钻，或浏览全部")}
            </div>
          )}
        {page.loadingMore && <div class="empty">加载更多…</div>}
        {rows.length > 0 && page.error && <div class="empty">{page.error}</div>}
      </div>
    </section>
  );
}
