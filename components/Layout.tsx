import type { ComponentChildren } from "preact";
import ThemeToggle from "../islands/ThemeToggle.tsx";
import { IconDoc, IconFeedback, IconGitHub, IconLogout } from "./icons.tsx";

export type NavKey =
  | "upstream"
  | "models"
  | "logs"
  | "settings";

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "upstream", href: "/upstream", label: "上游管理" },
  { key: "models", href: "/models", label: "模型管理" },
  { key: "logs", href: "/logs", label: "日志" },
  { key: "settings", href: "/settings", label: "系统设置" },
];

interface LayoutProps {
  active?: NavKey;
  /** 品牌链接目标，默认首页 */
  brandHref?: string;
  /** 顶栏右侧操作区，默认「退出登录」图标按钮 */
  actions?: ComponentChildren;
  /** 页脚是否带图标（仅仪表盘原型如此） */
  footerIcons?: boolean;
  children: ComponentChildren;
}

export function Layout(
  { active, brandHref = "/", actions, footerIcons, children }: LayoutProps,
) {
  return (
    <>
      <header class="topbar">
        <div class="topbar-inner">
          <a href={brandHref} class="brand">
            <span class="logo-mark">TT</span>
            <span>TunTunShu</span>
          </a>
          <nav class="mainnav">
            {NAV.map((item) => (
              <a
                href={item.href}
                class={active === item.key ? "active" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div class="topbar-actions">
            <ThemeToggle />
            {actions ?? (
              <a class="icon-btn" href="/login" title="退出登录">
                <IconLogout />
              </a>
            )}
          </div>
        </div>
      </header>

      <main class="appmain">{children}</main>

      <footer class="appfoot">
        <div class="appfoot-inner">
          <span class="ver">v1.5.0</span>
          <span class="sep">·</span>
          {footerIcons
            ? (
              <>
                <a href="#">
                  <IconDoc />文档
                </a>
                <span class="sep">·</span>
                <a href="#">
                  <IconGitHub />GitHub
                </a>
                <span class="sep">·</span>
                <a href="#">
                  <IconFeedback />反馈
                </a>
              </>
            )
            : (
              <>
                <a href="#">文档</a>
                <span class="sep">·</span>
                <a href="#">GitHub</a>
                <span class="sep">·</span>
                <a href="#">反馈</a>
              </>
            )}
          <span class="copy">
            © 2026 TunTunShu · MIT License · 个人单人实例
          </span>
        </div>
      </footer>
    </>
  );
}
