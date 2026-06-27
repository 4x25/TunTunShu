import { useCallback, useEffect, useState } from "preact/hooks";

export type UrlState = Record<string, string>;

/** 读取当前 URL 的 query 为普通对象;SSR(Deno 渲染 island)阶段无 location,返回空对象避免抛错。 */
function parse(): UrlState {
  if (typeof globalThis.location === "undefined") return {};
  return Object.fromEntries(new URLSearchParams(globalThis.location.search));
}

/** 把状态写回 URL(replaceState,不堆历史记录);空值键不写入,保持 query 干净。 */
function write(next: UrlState) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
  const qs = p.toString();
  globalThis.history.replaceState(
    null,
    "",
    qs ? `${globalThis.location.pathname}?${qs}` : globalThis.location.pathname,
  );
}

/**
 * 以 URL query 为唯一事实来源的状态 hook。
 * - 读取:`urlState` 始终反映当前 URL query。
 * - 写入:`setUrlState(patch)` 以当前 URL 为基准合并增量 patch;传空串即删除该键。
 */
export function useUrlState(): [UrlState, (patch: UrlState) => void] {
  // SSR 与客户端首帧 hydration 均为 {},避免 hydration mismatch;挂载后再读 URL。
  const [state, setState] = useState<UrlState>({});

  useEffect(() => {
    setState(parse());
    const onPop = () => setState(parse()); // 前进/后退或手动改 URL 时同步
    globalThis.addEventListener("popstate", onPop);
    return () => globalThis.removeEventListener("popstate", onPop);
  }, []);

  const setUrlState = useCallback((patch: UrlState) => {
    write({ ...parse(), ...patch }); // 始终以「当前 URL」为基准合并 → URL 是唯一事实
    setState(parse());
  }, []);

  return [state, setUrlState];
}
