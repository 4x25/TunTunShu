import { EndpointIcon } from "../brand_icons.tsx";
import classNames from "classnames";
import { IconChat, IconImage, IconSearch, IconTool } from "../icons.tsx";
import { ENDPOINT_LABELS, ENDPOINT_OPTIONS, TEST_KINDS } from "./constants.ts";
import { handleColumnScroll } from "./list_state.ts";
import { PerfBadge } from "./PerfBadge.tsx";
import { MillerRow, RowActions, RowHead } from "./row_primitives.tsx";
import type { ListPage, Model, TestKind, UpstreamModel } from "./types.ts";

/** 三种测试入口的图标(横向 icon menu;文案放 tooltip)。 */
const TEST_ICONS: Record<TestKind, typeof IconChat> = {
  chat: IconChat,
  vision: IconImage,
  tool: IconTool,
};

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
                      class={classNames("dd ep-dd", {
                        open: openEp === m.id,
                      })}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        class="ep-btn tooltip tooltip-bottom tooltip-start"
                        data-tip={`协议:${
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
                              class={classNames("dd-item", {
                                sel: m.endpoint_type === ep,
                              })}
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
                <div class={classNames("dd", { open: openDd === m.id })}>
                  <button
                    type="button"
                    class={classNames("dd-btn", { unmapped: !mapped })}
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
                        class={classNames("dd-item", { sel: !mapped })}
                        style="color:var(--muted)"
                        onClick={() => onMap(m.id, null)}
                      >
                        清除映射（无映射）
                      </div>
                      {ddItems.map((mod) => (
                        <div
                          key={mod.id}
                          class={classNames("dd-item", {
                            sel: m.model_id === mod.id,
                          })}
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
                <RowActions left={<PerfBadge perf={m.perf} />}>
                  <ul class="menu menu-horizontal menu-xs perf-test-menu">
                    {TEST_KINDS.map((t) => {
                      const Icon = TEST_ICONS[t.kind];
                      return (
                        <li key={t.kind}>
                          <button
                            type="button"
                            class="tooltip tooltip-bottom tooltip-end"
                            data-tip={t.label}
                            aria-label={t.label}
                            disabled={busy === "ep" + m.id}
                            onClick={() => onRunTest(m, t.kind)}
                          >
                            <Icon />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </RowActions>
              </MillerRow>
            );
          })
          : (
            <div class="empty">
              {page.loading ? "加载中…" : page.error ??
                (selectedKeyId != null
                  ? "该 Key 下暂无模型，先在账号列「检测」再在此列「拉取模型」"
                  : "选择 APIKey 下钻，或浏览全部")}
            </div>
          )}
        {page.loadingMore && <div class="empty">加载更多…</div>}
        {rows.length > 0 && page.error && <div class="empty">{page.error}</div>}
      </div>
    </section>
  );
}
