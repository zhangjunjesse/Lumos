// Weekly Etsy trend signals — 周度趋势数据合成
// 复用 EHunt + eRank 抓取，过期 7 天 stale 兜底，绝不 mock。
// MVP 阶段抓取桥未接通时显式 status='failed' + 兜底 evergreen 主题让推送跑得起来。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type SignalsStatus, type WeeklySignals } from './types';

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function loadCurrentSignals(store: AppDataStore): WeeklySignals {
  const rows = store.query<{
    fetched_at?: string;
    valid_until?: string;
    rising_themes_json?: string;
    color_trends_json?: string;
    composition_trends_json?: string;
    category_trends_json?: string;
    status?: SignalsStatus;
    failure_reason?: string;
    source_summary?: string;
  }>(COLLECTIONS.WEEKLY, {
    orderBy: { field: 'fetched_at', direction: 'desc' },
    limit: 1,
  });

  if (rows.length === 0) {
    return emptySignals('未抓取任何趋势数据 — 请到自动化页运行「趋势数据周更巡更」或等待定时任务');
  }

  const row = rows[0];
  const fetchedAt = row.fetched_at ? Date.parse(row.fetched_at) : 0;
  const stale = Date.now() - fetchedAt > STALE_AFTER_MS;
  const explicitStatus = row.status ?? 'fresh';
  const status: SignalsStatus =
    explicitStatus === 'failed' ? 'failed' : stale ? 'stale' : explicitStatus;

  return {
    rising_themes: parseJsonArray(row.rising_themes_json),
    color_trends: parseJsonArray(row.color_trends_json),
    composition_trends: parseJsonArray(row.composition_trends_json),
    category_trends: parseJsonArray(row.category_trends_json),
    fetched_at: row.fetched_at ?? '',
    valid_until: row.valid_until ?? '',
    status,
    failure_reason: row.failure_reason,
    source_summary: row.source_summary,
  };
}

/**
 * Refresh weekly Etsy trend signals by orchestrating EHunt + eRank crawlers.
 *
 * 当前实现 (MVP)：EHunt + eRank 抓取桥需要 AdsPower profile 真实可用；
 * 桥未接通时显式写一条 status='failed' 记录，failure_reason 说明原因，
 * UI 显示后用户可以决定是否走 evergreen fallback 推送（recommender 自动 fallback）。
 */
export async function refreshWeeklySignals(
  store: AppDataStore,
): Promise<{ ok: boolean; reason?: string }> {
  const startedAt = new Date().toISOString();
  const validUntil = new Date(Date.now() + STALE_AFTER_MS).toISOString();

  try {
    const signals = await tryFetchFromCrawlers();

    if (!signals) {
      store.create(COLLECTIONS.WEEKLY, {
        rising_themes_json: '[]',
        color_trends_json: '[]',
        composition_trends_json: '[]',
        category_trends_json: '[]',
        source_summary:
          'EHunt + eRank 抓取桥未接入 — etsy-forge MVP 阶段以骨架形态发布，待桥接通后真实回填。',
        fetched_at: startedAt,
        valid_until: validUntil,
        status: 'failed' as SignalsStatus,
        failure_reason:
          'EHunt + eRank 抓取桥未接入 — 请检查 AdsPower profile 可用性、bridge configure 是否完成。在桥接通前 recommender 将自动走 evergreen 主题兜底推送，不影响刷图主链。',
      });
      return { ok: false, reason: 'crawler-bridge-not-connected' };
    }

    store.create(COLLECTIONS.WEEKLY, {
      rising_themes_json: JSON.stringify(signals.rising_themes),
      color_trends_json: JSON.stringify(signals.color_trends),
      composition_trends_json: JSON.stringify(signals.composition_trends),
      category_trends_json: JSON.stringify(signals.category_trends),
      source_summary: signals.source_summary ?? '',
      fetched_at: startedAt,
      valid_until: validUntil,
      status: 'fresh' as SignalsStatus,
    });
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    store.create(COLLECTIONS.WEEKLY, {
      rising_themes_json: '[]',
      color_trends_json: '[]',
      composition_trends_json: '[]',
      category_trends_json: '[]',
      source_summary: '',
      fetched_at: startedAt,
      valid_until: validUntil,
      status: 'failed' as SignalsStatus,
      failure_reason: reason,
    });
    return { ok: false, reason };
  }
}

/**
 * P1 集成点 — 调 src/lib/ecommerce-assistant/ehunt/collect.ts + src/lib/etsy-erank/seed-collector.ts
 * 然后做特征抽取 + 合成。当前返回 null 显式 not-connected。
 */
async function tryFetchFromCrawlers(): Promise<WeeklySignals | null> {
  return null;
}

/**
 * 兜底 evergreen 主题：抓取桥未接入时推送策略走这里
 * 这不是 mock 数据 — 是设计师沉淀的常青题材，避免应用空跑。
 */
export const FALLBACK_EVERGREEN_THEMES: Array<{
  theme: string;
  styles: string[];
  palette: string[];
  composition: string;
}> = [
  {
    theme: 'vintage dog portrait',
    styles: ['line art', 'watercolor', 'minimal flat'],
    palette: ['#3A5F4A', '#D4A373', '#FAEDCD', '#283618'],
    composition: 'centered single portrait, off-white background',
  },
  {
    theme: 'cozy autumn cat',
    styles: ['hand-drawn', 'soft pastel'],
    palette: ['#E07A5F', '#F4A261', '#F2E8CF', '#264653'],
    composition: 'curled cat with autumn leaves border',
  },
  {
    theme: 'minimalist sourdough bread',
    styles: ['line art', 'flat illustration'],
    palette: ['#A47148', '#F2E8CF', '#000000'],
    composition: 'single loaf, minimal shadows, lots of white space',
  },
  {
    theme: 'crochet bouquet pattern',
    styles: ['vintage', 'watercolor'],
    palette: ['#FFB4A2', '#E5989B', '#B5838D', '#6D6875'],
    composition: 'flat-lay bouquet, no background clutter',
  },
  {
    theme: 'mountain hiking silhouette',
    styles: ['minimal flat', 'screen print'],
    palette: ['#1A4E3A', '#2D6A4F', '#95D5B2', '#000000'],
    composition: 'distant hiker silhouette against layered mountains',
  },
  {
    theme: 'wildflower botanical study',
    styles: ['vintage botanical', 'pen and ink'],
    palette: ['#606C38', '#283618', '#FEFAE0', '#DDA15E'],
    composition: 'centered single specimen with latin name placeholder area',
  },
  {
    theme: 'sourdough starter named character',
    styles: ['hand-drawn', 'cute illustration'],
    palette: ['#F4A261', '#E76F51', '#264653', '#F1FAEE'],
    composition: 'mason jar with face, gentle bubbles',
  },
  {
    theme: 'border collie agility silhouette',
    styles: ['silhouette', 'screen print'],
    palette: ['#000000', '#FFFFFF', '#E63946'],
    composition: 'jumping pose mid-action, simple ground line',
  },
];

function emptySignals(reason: string): WeeklySignals {
  return {
    rising_themes: [],
    color_trends: [],
    composition_trends: [],
    category_trends: [],
    fetched_at: '',
    valid_until: '',
    status: 'failed',
    failure_reason: reason,
  };
}

function parseJsonArray<T>(s: string | undefined): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
