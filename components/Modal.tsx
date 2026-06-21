import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

// 退场动画时长,需与 assets/app.css 的 ttModalCardOut/ttModalMaskOut 一致。
const EXIT_MS = 160;

/**
 * 带进出场动画的弹窗外壳(DaisyUI Modal 风格)。
 * - open 由父级控制;关闭时先播放退场动画,再真正卸载。
 * - 点击遮罩空白处关闭(点击卡片内部不关闭);Esc 由各页面自身处理。
 * - 退场期间 open=false,父级 `{cond && (...)}` 传入的 children 会变 null,
 *   因此缓存最近一次内容,退场动画期间继续渲染它。
 */
export function Modal(
  { open, onClose, wide, children }: {
    open: boolean;
    onClose: () => void;
    wide?: boolean;
    children: ComponentChildren;
  },
) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const cached = useRef<ComponentChildren>(children);
  const timer = useRef<number | undefined>(undefined);

  if (open) cached.current = children;

  useEffect(() => {
    clearTimeout(timer.current);
    if (open) {
      setClosing(false);
      setMounted(true);
    } else if (mounted) {
      setClosing(true);
      timer.current = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, EXIT_MS) as unknown as number;
    }
    return () => clearTimeout(timer.current);
    // 仅在 open 变化时驱动进出场
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      class={`modal-mask on${closing ? " closing" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class={`modal-card${wide ? " wide" : ""}${closing ? " closing" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        {open ? children : cached.current}
      </div>
    </div>
  );
}
