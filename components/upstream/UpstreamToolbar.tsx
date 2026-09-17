import classNames from "classnames";
import type { Flash } from "./types.ts";

export function UpstreamToolbar(
  {
    flash,
    busy,
    onRefresh,
    onReset,
    onInstallScript,
  }: {
    flash: Flash | null;
    busy: string | null;
    onRefresh: () => void;
    onReset: () => void;
    onInstallScript: () => void;
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
            class={classNames("pill", {
              "pill-ok": flash.ok,
              "pill-bad": !flash.ok,
            })}
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
          class="btn btn-ghost btn-sm tooltip tooltip-bottom tooltip-end"
          data-tip="安装「囤囤鼠脚本」:在 new-api 站点一键录入账号,并用 PAT 免登上游后台"
          onClick={onInstallScript}
        >
          囤囤鼠脚本
        </button>
      </div>
    </div>
  );
}
