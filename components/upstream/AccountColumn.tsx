import { IconSearch } from "../icons.tsx";
import { usd } from "./constants.ts";
import { CreateMenu } from "./CreateMenu.tsx";
import { handleColumnScroll } from "./list_state.ts";
import {
  ActBtn,
  MillerRow,
  RowActions,
  RowHead,
  RowSub,
} from "./row_primitives.tsx";
import type { Account, ListPage } from "./types.ts";

export function AccountColumn(
  {
    page,
    rows,
    q,
    selectedId,
    selectedSiteId,
    busy,
    checkinMsg,
    onKeywordChange,
    onLoadMore,
    onCreate,
    onBatch,
    onPick,
    onToggle,
    onLogin,
    onCheckin,
    onCheck,
    onEdit,
    onDelete,
  }: {
    page: ListPage<Account>;
    rows: Account[];
    q: string;
    selectedId: string | null;
    selectedSiteId: string | null;
    busy: string | null;
    checkinMsg: Record<string, string>;
    onKeywordChange: (value: string) => void;
    onLoadMore: () => void;
    onCreate: () => void;
    onBatch: () => void;
    onPick: (id: string) => void;
    onToggle: (account: Account) => void;
    onLogin: (account: Account) => void;
    onCheckin: (account: Account) => void;
    onCheck: (account: Account) => void;
    onEdit: (account: Account) => void;
    onDelete: (account: Account) => void;
  },
) {
  return (
    <section class="mcol">
      <div class="mcol-head">
        <div class="mcol-titlebar">
          <h3>账号</h3>
          <span class="cnt">{rows.length} / {page.totalCount}</span>
          {page.refreshing && rows.length > 0 && (
            <span class="meta faint">刷新中…</span>
          )}
          <CreateMenu
            id="account"
            createLabel="+ 新建账号"
            onCreate={onCreate}
            busy={busy}
            actions={[
              {
                key: "check-checkin",
                label: "批量检测和批量签到",
                onRun: onBatch,
              },
            ]}
          />
        </div>
      </div>
      <div class="mcol-search">
        <div class="search">
          <IconSearch />
          <input
            class="input"
            placeholder="筛选账号名称 / 用户 ID"
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
          ? rows.map((a) => {
            const q = Number(a.quota), u = Number(a.used_quota);
            const ciBusy = busy === "ci" + a.id;
            // 站点未开放签到(来自 sites.status_data.checkin_enabled;null=未知,
            // 按可点击处理)
            const siteCheckinOff = a.site_checkin_enabled === false;
            const checked = a.checkin_status === "checked";
            const manualRequired = !ciBusy &&
              a.checkin_status === "manual_required";
            const ciLabel = ciBusy
              ? "验证中…"
              : checked
              ? "已签到"
              : a.checkin_status === "failed"
              ? "签到失败"
              : manualRequired
              ? "需手动"
              : "签到";
            const ciTone: "ok" | "bad" | undefined = checked
              ? "ok"
              : a.checkin_status === "failed"
              ? "bad"
              : undefined;
            // 已签到 tip:签到日期与收获额度(无记录时退回本次操作回执)。
            const checkinTip = checked
              ? (a.checkin_date
                ? `签到日期 ${a.checkin_date}${
                  a.checkin_quota != null
                    ? ` · 收获 $${usd(a.checkin_quota).toFixed(2)}`
                    : ""
                }`
                : checkinMsg[a.id])
              : checkinMsg[a.id];
            const ciTitle = siteCheckinOff
              ? "站点未开放签到功能"
              : checkinTip || undefined;
            const ciDisabled = ciBusy || siteCheckinOff;
            return (
              <MillerRow
                key={a.id}
                selected={selectedId === a.id}
                off={!a.enabled}
                onClick={() => onPick(a.id)}
              >
                <RowHead
                  name={a.name}
                  status={a.status}
                  on={a.enabled}
                  onToggle={() => onToggle(a)}
                />
                <RowSub>
                  {a.user_id} · 余 ${usd(String(q - u)).toFixed(2)} / $
                  {usd(a.quota).toFixed(2)}
                </RowSub>
                <RowActions>
                  <ActBtn
                    disabled={busy === "ac" + a.id}
                    onClick={() => onCheck(a)}
                  >
                    {busy === "ac" + a.id ? "检测中…" : "检测"}
                  </ActBtn>
                  <ActBtn onClick={() => onLogin(a)}>登录</ActBtn>
                  <ActBtn
                    tone={ciTone}
                    title={ciTitle}
                    disabled={ciDisabled}
                    onClick={() => onCheckin(a)}
                  >
                    {manualRequired
                      ? <span style="color:var(--warn)">{ciLabel}</span>
                      : ciLabel}
                  </ActBtn>
                  <ActBtn onClick={() => onEdit(a)}>编辑</ActBtn>
                  <ActBtn danger onClick={() => onDelete(a)}>删除</ActBtn>
                </RowActions>
              </MillerRow>
            );
          })
          : (
            <div class="empty">
              {page.loading ? "加载中…" : page.error ??
                (selectedSiteId != null
                  ? "该站点下暂无账号"
                  : "选择站点下钻，或浏览全部")}
            </div>
          )}
        {page.loadingMore && <div class="empty">加载更多…</div>}
        {rows.length > 0 && page.error && <div class="empty">{page.error}</div>}
      </div>
    </section>
  );
}
