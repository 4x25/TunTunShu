// 浏览器侧复制到剪贴板：优先异步 Clipboard API；非安全上下文（纯 HTTP 自建
// 部署）下 navigator.clipboard 不存在，退回 execCommand 选区方案。两者都不可用
// 时抛错，由调用方提示用户。
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // 权限被拒或非安全上下文 —— 落到下面的兜底方案
  }
  if (!copyViaSelection(text)) throw new Error("当前浏览器不允许复制");
}

function copyViaSelection(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
