import type { ComponentChildren, JSX } from "preact";
import { IconCheck, IconCopy } from "../icons.tsx";
import { STATUS_MAP } from "./constants.ts";

export function Pill({ status }: { status: string }) {
  const x = STATUS_MAP[status] || STATUS_MAP.unknown;
  return (
    <span class={`pill pill-${x[0]}`}>
      <span class="dot"></span>
      {x[1]}
    </span>
  );
}

export function Switch(
  { on, onChange }: { on: boolean; onChange: () => void },
) {
  return (
    <span class="sw-wrap" onClick={(e) => e.stopPropagation()}>
      <label class="switch">
        <input type="checkbox" checked={on} onChange={onChange} />
        <span class="track"></span>
      </label>
    </span>
  );
}

export function MillerRow(
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

export function RowHead(
  { name, status, on, onToggle, leading }: {
    name: string;
    status: string;
    on: boolean;
    onToggle: () => void;
    leading?: ComponentChildren;
  },
) {
  return (
    <div class="l1">
      {leading}
      <span class="nm">{name}</span>
      <Pill status={status} />
      <Switch on={on} onChange={onToggle} />
    </div>
  );
}

export function RowSub({ children }: { children: ComponentChildren }) {
  return <div class="l2">{children}</div>;
}

export function RowActions(
  { left, children }: { left?: ComponentChildren; children: ComponentChildren },
) {
  return (
    <div class="row-actions">
      {left && <div class="ra-left">{left}</div>}
      <div class="ra-btns">{children}</div>
    </div>
  );
}

export function ActBtn(
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

/* 行内小图标按钮：复制文本到剪贴板，复制成功后短暂显示对勾 */
export function CopyBtn(
  { title, copied, onClick }: {
    title: string;
    copied?: boolean;
    onClick: () => void;
  },
) {
  const label = copied ? "已复制" : title;
  return (
    <button
      type="button"
      class="copy-btn"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

export function Field(
  { label, hint, k, form, error, type, update }: {
    label: string;
    hint: string;
    k: string;
    form: Record<string, string>;
    error?: string;
    type?: string;
    update: (k: string, v: string) => void;
  },
): JSX.Element {
  return (
    <div class="field">
      <label>{label}</label>
      <input
        class={`input${error ? " input-err" : ""}`}
        type={type ?? "text"}
        placeholder={hint}
        value={form[k] ?? ""}
        onInput={(e) => update(k, (e.target as HTMLInputElement).value)}
      />
      {error && <span class="field-err">{error}</span>}
    </div>
  );
}
