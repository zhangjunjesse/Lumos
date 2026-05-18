/**
 * 类目&关键词调研 —— 持久化（自有 AppDataStore collection，独立于资讯调研
 * 的 research-storage，两域解耦）。报告体量小，report_json/markdown 内联存行。
 */
import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import { getEcommerceStore } from './storage';
import type { KeywordResearchReport, KeywordResearchRecord } from './keyword-research-types';

export type KeywordResearchRow = AppRow<KeywordResearchRecord>;

const COLLECTION = 'keyword_research';

export function getKeywordStore(): AppDataStore {
  return getEcommerceStore();
}

export interface CreateKeywordRunArgs {
  categoryIds: string[];
  categoryLabel: string;
}

export function createKeywordRun(
  store: AppDataStore,
  args: CreateKeywordRunArgs,
): KeywordResearchRow {
  const now = new Date().toISOString();
  return store.create<KeywordResearchRecord>(COLLECTION, {
    status: 'pending',
    stage: 'queued',
    progress: 0,
    category_ids: JSON.stringify(args.categoryIds),
    category_label: args.categoryLabel,
    started_at: null,
    completed_at: null,
    error: null,
    summary: '',
    ehunt_detected: 0,
    keyword_count: 0,
    listing_count: 0,
    report_json: null,
    report_markdown: null,
    created_at: now,
  });
}

export function getKeywordRun(
  store: AppDataStore,
  id: string,
): KeywordResearchRow | null {
  return store.get<KeywordResearchRecord>(COLLECTION, id);
}

/** 最新在前；可选 limit 上限（避免 UI 每 3s 轮询拉无界全表）。 */
export function listKeywordRuns(
  store: AppDataStore,
  limit?: number,
): KeywordResearchRow[] {
  // 最新在前；同毫秒 created_at 用 id 兜底稳定排序（比较器对相等必须收敛，
  // 否则同时刻创建的 run 每次轮询重排会让列表抖动）。
  const rows = store
    .query<KeywordResearchRecord>(COLLECTION)
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
  return limit && limit > 0 ? rows.slice(0, limit) : rows;
}

export function patchKeywordRun(
  store: AppDataStore,
  id: string,
  patch: Partial<KeywordResearchRecord>,
): void {
  store.update(COLLECTION, id, patch);
}

export function deleteKeywordRun(store: AppDataStore, id: string): boolean {
  return store.delete(COLLECTION, id);
}

/** 把结构化报告写回行（json + markdown + 摘要计数）。 */
export function persistKeywordReport(
  store: AppDataStore,
  id: string,
  report: KeywordResearchReport,
  markdown: string,
): void {
  const keywordCount = report.categories.reduce((s, c) => s + c.scoredKeywords.length, 0);
  const listingCount = report.categories.reduce((s, c) => s + c.listingCount, 0);
  patchKeywordRun(store, id, {
    report_json: JSON.stringify(report),
    report_markdown: markdown,
    ehunt_detected: report.ehuntCoverage.detected,
    keyword_count: keywordCount,
    listing_count: listingCount,
  });
}
