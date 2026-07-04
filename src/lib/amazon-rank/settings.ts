import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { normalizeBrowserContextId } from '@/lib/browser-provider/labels';

import { DEFAULT_RANK_SETTINGS, HARD_MAX_KEYWORDS, ASIN_RE } from './constants';
import type { RankSettings, RankWatchlist } from './types';

/**
 * 设置与监控清单都存在 app_settings 集合的单行 typed 记录里
 * （与 etsy-forge 同款：一行、字段即设置项，通用页面壳也能直接绑定）。
 */

interface SettingsRow extends Record<string, unknown> {
  id?: string;
  ai_system_prompt?: string;
  risk_note?: string;
  site?: string;
  zip_code?: string;
  browser_context_id?: string;
  incognito?: boolean;
  delay_min_ms?: number;
  delay_max_ms?: number;
  max_keywords?: number;
  watchlist_keywords?: string[];
  watchlist_asins?: string[];
  updated_at?: string;
}

function readRow(store: AppDataStore): SettingsRow | undefined {
  return store.query<SettingsRow>('app_settings', { limit: 1 }).at(0);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSite(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const host = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^([a-z0-9-]+\.)+amazon\.[a-z.]+$/.test(host) ? host : DEFAULT_RANK_SETTINGS.site;
}

function normalizeZip(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return /^[0-9]{5}$/.test(raw) ? raw : DEFAULT_RANK_SETTINGS.zipCode;
}

export function rowToSettings(row: SettingsRow | undefined): RankSettings {
  const d = DEFAULT_RANK_SETTINGS;
  if (!row) return { ...d };
  const delayMin = clampInt(row.delay_min_ms, 1_000, 60_000, d.delayMinMs);
  return {
    site: normalizeSite(row.site),
    zipCode: normalizeZip(row.zip_code),
    browserContextId: normalizeBrowserContextId(
      typeof row.browser_context_id === 'string' ? row.browser_context_id : undefined,
    ),
    incognito: row.incognito !== false,
    delayMinMs: delayMin,
    delayMaxMs: clampInt(row.delay_max_ms, delayMin, 120_000, Math.max(delayMin, d.delayMaxMs)),
    maxKeywords: clampInt(row.max_keywords, 1, HARD_MAX_KEYWORDS, d.maxKeywords),
    aiSystemPrompt:
      typeof row.ai_system_prompt === 'string' && row.ai_system_prompt.trim()
        ? row.ai_system_prompt
        : d.aiSystemPrompt,
    riskNote:
      typeof row.risk_note === 'string' && row.risk_note.trim() ? row.risk_note : d.riskNote,
  };
}

export function getRankSettings(store: AppDataStore): RankSettings {
  return rowToSettings(readRow(store));
}

export function setRankSettings(store: AppDataStore, patch: Partial<RankSettings>): RankSettings {
  const current = getRankSettings(store);
  const next: RankSettings = { ...current, ...patch };
  const normalized = rowToSettings({
    site: next.site,
    zip_code: next.zipCode,
    browser_context_id: next.browserContextId,
    incognito: next.incognito,
    delay_min_ms: next.delayMinMs,
    delay_max_ms: next.delayMaxMs,
    max_keywords: next.maxKeywords,
    ai_system_prompt: next.aiSystemPrompt,
    risk_note: next.riskNote,
  });
  writeRow(store, {
    site: normalized.site,
    zip_code: normalized.zipCode,
    browser_context_id: normalized.browserContextId,
    incognito: normalized.incognito,
    delay_min_ms: normalized.delayMinMs,
    delay_max_ms: normalized.delayMaxMs,
    max_keywords: normalized.maxKeywords,
    ai_system_prompt: normalized.aiSystemPrompt,
    risk_note: normalized.riskNote,
  });
  return normalized;
}

export function getWatchlist(store: AppDataStore): RankWatchlist {
  const row = readRow(store);
  return {
    keywords: sanitizeKeywords(row?.watchlist_keywords),
    asins: sanitizeAsins(row?.watchlist_asins),
  };
}

export function setWatchlist(store: AppDataStore, watchlist: RankWatchlist): RankWatchlist {
  const next = {
    keywords: sanitizeKeywords(watchlist.keywords),
    asins: sanitizeAsins(watchlist.asins),
  };
  writeRow(store, { watchlist_keywords: next.keywords, watchlist_asins: next.asins });
  return next;
}

function sanitizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const kw = item.trim();
    const key = kw.toLowerCase();
    if (!kw || kw.length > 200 || seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out.slice(0, HARD_MAX_KEYWORDS);
}

function sanitizeAsins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const asin = item.trim().toUpperCase();
    if (!ASIN_RE.test(asin) || seen.has(asin)) continue;
    seen.add(asin);
    out.push(asin);
  }
  return out;
}

function writeRow(store: AppDataStore, patch: Partial<SettingsRow>): void {
  const existing = readRow(store);
  const updated_at = new Date().toISOString();
  if (existing?.id) {
    store.update<SettingsRow>('app_settings', existing.id, { ...patch, updated_at });
  } else {
    store.create<SettingsRow>('app_settings', { ...patch, updated_at });
  }
}
