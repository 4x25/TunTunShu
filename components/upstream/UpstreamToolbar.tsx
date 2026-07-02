import type { Flash } from "./types.ts";

export function UpstreamToolbar(
  { flash, busy, onRefresh, onReset, onQuickEntry }: {
    flash: Flash | null;
    busy: string | null;
    onRefresh: () => void;
    onReset: () => void;
    onQuickEntry: () => void;
  },
) {
  return (
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
        <button type="button" class="btn btn-ghost btn-sm" onClick={onRefresh}>
          刷新
        </button>
        <button type="button" class="btn btn-ghost btn-sm" onClick={onReset}>
          清除筛选
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          title="安装油猴脚本,在 new-api 站点一键录入站点与账号"
          onClick={onQuickEntry}
        >
          快捷录入
        </button>
      </div>
    </div>
  );
}
