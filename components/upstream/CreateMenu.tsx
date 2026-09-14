import classNames from "classnames";

export interface MenuAction {
  key: string;
  label: string;
  title?: string;
  onRun: () => void;
}

/**
 * 列标题栏「新建 + 批量操作」按钮组。全部使用 daisyUI 既有组件:
 * - `join` 把创建按钮与下拉按钮合并为一组;
 * - 下拉用 daisyUI 5 的 Popover API 写法(`popovertarget` + `popover` +
 *   `anchor-name`/`position-anchor`),浏览器原生提供点击外部关闭与 Escape,
 *   无需 JS 管理开合状态;
 * - 菜单项是 `menu` 组件,浮层样式 `rounded-box bg-base-100 shadow-sm`。
 * `id` 需页面内唯一,用于 popover id 与 CSS anchor 命名。
 */
export function CreateMenu(
  {
    id,
    createLabel,
    onCreate,
    actions,
    busy,
  }: {
    id: string;
    createLabel: string;
    onCreate: () => void;
    actions: MenuAction[];
    busy: string | null;
  },
) {
  const menuId = `batch-menu-${id}`;
  const anchor = `--batch-anchor-${id}`;
  const spinning = busy != null && busy.startsWith("batch");

  return (
    <div class="add">
      <div class="join">
        <button
          type="button"
          class="btn btn-primary btn-sm join-item"
          onClick={onCreate}
        >
          {createLabel}
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm join-item tooltip tooltip-bottom tooltip-end"
          data-tip="批量操作"
          popovertarget={menuId}
          style={`anchor-name:${anchor}`}
          disabled={busy != null}
        >
          {spinning ? <span class="loading loading-xs"></span> : <span>▾</span>}
        </button>
      </div>
      <ul
        class="dropdown dropdown-end menu w-52 rounded-box bg-base-100 p-2 shadow-sm"
        popover="auto"
        id={menuId}
        style={`position-anchor:${anchor}`}
      >
        {actions.map((a) => (
          <li key={a.key}>
            <button
              type="button"
              class={classNames({ tooltip: a.title })}
              data-tip={a.title}
              onClick={() => {
                document.getElementById(menuId)?.hidePopover();
                a.onRun();
              }}
            >
              {a.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
