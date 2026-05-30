// 商品列表的排序/筛选纯函数（按 EHunt 指标）。无指标的按 0 计。

import type { Product } from '../api-client';

export type SortBy = 'default' | 'sales' | 'favorites' | 'price';

export const salesOf = (p: Product) => p.ehunt?.salesTotal ?? 0;
export const favsOf = (p: Product) => p.ehunt?.favorites ?? 0;

const priceOf = (p: Product) => {
  const n = parseFloat((p.price ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : Infinity;
};

export function sortItems(items: Product[], sortBy: SortBy): Product[] {
  if (sortBy === 'default') return items;
  const arr = [...items];
  if (sortBy === 'sales') arr.sort((a, b) => salesOf(b) - salesOf(a));
  else if (sortBy === 'favorites') arr.sort((a, b) => favsOf(b) - favsOf(a));
  else if (sortBy === 'price') arr.sort((a, b) => priceOf(a) - priceOf(b));
  return arr;
}

export interface RunGroup {
  runId: string;
  keyword: string;
  runAt: string;
  seq: number; // 同关键词内第几次执行（1 起）
  items: Product[];
}

// 按每次执行（run_id）分组；同关键词内按执行时间给「第 N 次」序号；最近执行排最前；组内按 sortBy 排序。
export function buildRunGroups(products: Product[], sortBy: SortBy): RunGroup[] {
  const byRun = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.run_id ?? `legacy-${p.keyword}`;
    const arr = byRun.get(key) ?? [];
    arr.push(p);
    byRun.set(key, arr);
  }
  const list = Array.from(byRun.entries()).map(([runId, items]) => ({
    runId,
    keyword: items[0]?.keyword ?? '',
    runAt: items[0]?.run_at ?? items.reduce((m, p) => (p.created_at > m ? p.created_at : m), ''),
    items: sortItems(items, sortBy),
  }));
  const seqMap = new Map<string, number>();
  const byKeyword = new Map<string, { runId: string; runAt: string }[]>();
  for (const g of list) {
    const a = byKeyword.get(g.keyword) ?? [];
    a.push({ runId: g.runId, runAt: g.runAt });
    byKeyword.set(g.keyword, a);
  }
  for (const arr of byKeyword.values()) {
    arr.sort((a, b) => (a.runAt < b.runAt ? -1 : 1));
    arr.forEach((x, i) => seqMap.set(x.runId, i + 1));
  }
  return list
    .map((g) => ({ ...g, seq: seqMap.get(g.runId) ?? 1 }))
    .sort((a, b) => (a.runAt < b.runAt ? 1 : -1));
}
