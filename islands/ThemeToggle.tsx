import { useEffect, useState } from "preact/hooks";

const KEY = "tts-theme";

/**
 * 主题切换按钮（深 / 浅）。挂载后读取 documentElement 的 data-theme 决定图标，
 * 点击时切换、写入 localStorage，并派发 `themechange` 事件（仪表盘图表据此重绘）。
 * 服务端渲染为空按钮，挂载后再填充图标，避免水合不一致。
 */
export default function ThemeToggle({ class: extra }: { class?: string }) {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setDark((root.getAttribute("data-theme") || "light") === "dark");
    setMounted(true);
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = (root.getAttribute("data-theme") || "light") === "dark"
      ? "light"
      : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch { /* ignore */ }
    setDark(next === "dark");
    document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  }

  const label = !mounted ? "切换主题" : dark ? "切换为浅色" : "切换为深色";

  return (
    <button
      type="button"
      class={extra ? `icon-btn ${extra}` : "icon-btn"}
      aria-label={label}
      title={mounted ? label : undefined}
      onClick={toggle}
    >
      {mounted &&
        (dark
          ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width={2}
              stroke-linecap="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          )
          : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width={2}
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          ))}
    </button>
  );
}
