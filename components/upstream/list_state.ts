import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { PAGE_SIZE } from "./constants.ts";
import type { ListPage } from "./types.ts";

export function emptyPage<T>(): ListPage<T> {
  return {
    items: [],
    pageIndex: 0,
    pageSize: PAGE_SIZE,
    totalCount: 0,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: null,
  };
}

export function mergePage<T>(
  prev: ListPage<T>,
  page: { items: T[]; pageIndex: number; pageSize: number; totalCount: number },
  append: boolean,
): ListPage<T> {
  return {
    items: append ? [...prev.items, ...page.items] : page.items,
    pageIndex: page.pageIndex,
    pageSize: page.pageSize,
    totalCount: page.totalCount,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: null,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "加载失败";
}

export function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function hasMore<T>(page: ListPage<T>): boolean {
  return page.items.length < page.totalCount;
}

export function handleColumnScroll<T>(
  event: JSX.TargetedEvent<HTMLDivElement>,
  page: ListPage<T>,
  loadMore: () => void,
) {
  if (page.loading || page.loadingMore || page.refreshing || !hasMore(page)) {
    return;
  }
  const el = event.currentTarget;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) loadMore();
}
