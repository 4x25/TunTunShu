import { IconSearch } from "../icons.tsx";
import { handleColumnScroll } from "./list_state.ts";
import {
  ActBtn,
  MillerRow,
  RowActions,
  RowHead,
  RowSub,
} from "./row_primitives.tsx";
import type { ListPage, Site } from "./types.ts";

export function SiteColumn(
  {
    page,
    rows,
    q,
    selectedId,
    busy,
    onKeywordChange,
    onLoadMore,
    onCreate,
    onPick,
    onToggle,
    onHealthCheck,
    onEdit,
    onDelete,
  }: {
    page: ListPage<Site>;
    rows: Site[];
    q: string;
    selectedId: string | null;
    busy: string | null;
    onKeywordChange: (value: string) => void;
    onLoadMore: () => void;
    onCreate: () => void;
    onPick: (id: string) => void;
    onToggle: (site: Site) => void;
    onHealthCheck: (site: Site) => void;
    onEdit: (site: Site) => void;
    onDelete: (site: Site) => void;
  },
) {
  return (
    <section class="mcol">
      <div class="mcol-head">
        <div class="mcol-titlebar">
          <h3>站点</h3>
          <span class="cnt">{rows.length} / {page.totalCount}</span>
          <button
            type="button"
            class="btn btn-primary btn-sm add"
            onClick={onCreate}
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
          ? rows.map((s) => (
            <MillerRow
              key={s.id}
              selected={selectedId === s.id}
              off={!s.enabled}
              onClick={() => onPick(s.id)}
            >
              <RowHead
                name={s.name}
                status={s.status}
                on={s.enabled}
                onToggle={() => onToggle(s)}
              />
              <RowSub>{s.origin}</RowSub>
              <RowActions>
                <ActBtn
                  disabled={busy === "hc" + s.id}
                  onClick={() => onHealthCheck(s)}
                >
                  {busy === "hc" + s.id ? "检测中…" : "检测"}
                </ActBtn>
                <ActBtn onClick={() => onEdit(s)}>编辑</ActBtn>
                <ActBtn danger onClick={() => onDelete(s)}>删除</ActBtn>
              </RowActions>
            </MillerRow>
          ))
          : (
            <div class="empty">
              {page.loading
                ? "加载中…"
                : page.error ?? "暂无站点，点击「+ 新建站点」"}
            </div>
          )}
        {page.loadingMore && <div class="empty">加载更多…</div>}
        {rows.length > 0 && page.error && <div class="empty">{page.error}</div>}
      </div>
    </section>
  );
}
