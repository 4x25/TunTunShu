import { IconSearch } from "../icons.tsx";
import { maskKey } from "./constants.ts";
import { handleColumnScroll } from "./list_state.ts";
import {
  ActBtn,
  CopyBtn,
  MillerRow,
  RowActions,
  RowHead,
  RowSub,
} from "./row_primitives.tsx";
import type { ApiKey, ListPage } from "./types.ts";

export function ApiKeyColumn(
  {
    page,
    rows,
    q,
    selectedId,
    selectedAccountId,
    busy,
    copiedId,
    onKeywordChange,
    onLoadMore,
    onCreate,
    onPick,
    onToggle,
    onCopyKey,
    onSyncModels,
    onDelete,
  }: {
    page: ListPage<ApiKey>;
    rows: ApiKey[];
    q: string;
    selectedId: string | null;
    selectedAccountId: string | null;
    busy: string | null;
    copiedId: string | null;
    onKeywordChange: (value: string) => void;
    onLoadMore: () => void;
    onCreate: () => void;
    onPick: (id: string) => void;
    onToggle: (key: ApiKey) => void;
    onCopyKey: (key: ApiKey) => void;
    onSyncModels: (key: ApiKey) => void;
    onDelete: (key: ApiKey) => void;
  },
) {
  return (
    <section class="mcol">
      <div class="mcol-head">
        <div class="mcol-titlebar">
          <h3>APIKey</h3>
          <span class="cnt">{rows.length} / {page.totalCount}</span>
          {page.refreshing && rows.length > 0 && (
            <span class="meta faint">刷新中…</span>
          )}
          <button
            type="button"
            class="btn btn-primary btn-sm add"
            onClick={onCreate}
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
          ? rows.map((k) => (
            <MillerRow
              key={k.id}
              selected={selectedId === k.id}
              off={!k.enabled}
              onClick={() => onPick(k.id)}
            >
              <RowHead
                name={k.name}
                status={k.status}
                on={k.enabled}
                onToggle={() => onToggle(k)}
              />
              <RowSub>
                <span class="keyline">
                  <span class="keytext">{maskKey(k.key)}</span>
                  <CopyBtn
                    title="复制密钥"
                    copied={copiedId === k.id}
                    onClick={() => onCopyKey(k)}
                  />
                </span>
              </RowSub>
              <RowActions>
                <ActBtn
                  disabled={busy === "sm" + k.id}
                  onClick={() => onSyncModels(k)}
                >
                  {busy === "sm" + k.id ? "拉取中…" : "拉取模型"}
                </ActBtn>
                <ActBtn danger onClick={() => onDelete(k)}>删除</ActBtn>
              </RowActions>
            </MillerRow>
          ))
          : (
            <div class="empty">
              {page.loading ? "加载中…" : page.error ??
                (selectedAccountId != null
                  ? "该账号下暂无 Key"
                  : "选择账号下钻，或浏览全部")}
            </div>
          )}
        {page.loadingMore && <div class="empty">加载更多…</div>}
        {rows.length > 0 && page.error && <div class="empty">{page.error}</div>}
      </div>
    </section>
  );
}
