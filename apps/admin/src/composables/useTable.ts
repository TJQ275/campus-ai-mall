import { onUnmounted, reactive, ref, type Ref } from 'vue';
import type { PageResult } from '../api';
import { isCancel, reportError } from './async';

interface PageQuery {
  page: number;
  pageSize: number;
}

export interface UseTable<T, Q extends PageQuery> {
  rows: Ref<T[]>;
  total: Ref<number>;
  loading: Ref<boolean>;
  query: Q;
  /** 查当前页（翻页、增删改后刷新用） */
  load: () => Promise<void>;
  /** 筛选条件变化：回到第一页再查 */
  search: () => Promise<void>;
  onPage: (page: number) => Promise<void>;
  /** 只把页码重置为 1，不发请求 */
  resetPage: () => void;
}

/**
 * 列表页公共状态：分页、加载态、竞态。
 * 每次请求都带 AbortController 并记住序号：快速切筛选时，先发出的旧响应会
 * 被丢弃，不会覆盖当前筛选条件的数据。
 */
export function useTable<T, Q extends PageQuery>(
  fetcher: (query: Q, signal: AbortSignal) => Promise<PageResult<T>>,
  initialQuery: Q,
): UseTable<T, Q> {
  const rows = ref<T[]>([]) as Ref<T[]>;
  const total = ref(0);
  const loading = ref(false);
  const query = reactive({ ...initialQuery }) as Q;

  let seq = 0;
  let controller: AbortController | null = null;

  async function load() {
    const current = ++seq;
    controller?.abort();
    controller = new AbortController();
    loading.value = true;
    try {
      const data = await fetcher(query, controller.signal);
      if (current !== seq) return;
      rows.value = data.list ?? [];
      total.value = data.total ?? 0;
    } catch (error) {
      if (current !== seq || isCancel(error)) return;
      reportError(error, '列表加载失败');
    } finally {
      if (current === seq) loading.value = false;
    }
  }

  async function search() {
    resetPage();
    await load();
  }

  async function onPage(page: number) {
    query.page = page;
    await load();
  }

  function resetPage() {
    query.page = 1;
  }

  onUnmounted(() => controller?.abort());

  return { rows, total, loading, query, load, search, onPage, resetPage };
}
