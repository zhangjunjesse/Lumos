// Taste Profile — 审美档案学习闭环
// 每次 👍 / 👎 入信号表；满 10 个新信号异步重算 profile；
// 三段冷启动：0-10 cold_start / 10-50 mixed / 50+ main

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import {
  COLLECTIONS,
  DEFAULT_SETTINGS,
  type AppSettings,
  type TasteProfile,
  type TasteSignalRow,
  type TasteStage,
} from './types';

export function loadTasteProfile(store: AppDataStore, userId: string): TasteProfile {
  const row = store.query<{
    user_id: string;
    profile_json?: string;
    signal_count?: number;
    stage?: TasteStage;
  }>(COLLECTIONS.PROFILE, { filter: { user_id: userId }, limit: 1 })[0];

  if (!row) return emptyProfile();
  try {
    const parsed = JSON.parse(row.profile_json ?? '{}') as Partial<TasteProfile>;
    return {
      ...emptyProfile(),
      ...parsed,
      signal_count: row.signal_count ?? parsed.signal_count ?? 0,
      stage: row.stage ?? parsed.stage ?? 'cold_start',
    };
  } catch {
    return emptyProfile();
  }
}

export function recordSignal(
  store: AppDataStore,
  userId: string,
  imageId: string,
  signal: 1 | -1,
  meta: { theme?: string; style?: string; palette?: string } = {},
): { profile_recomputed: boolean; total_signals: number } {
  const now = new Date().toISOString();
  store.create<Omit<TasteSignalRow, 'id'>>(COLLECTIONS.SIGNALS, {
    user_id: userId,
    image_id: imageId,
    signal,
    theme: meta.theme,
    style: meta.style,
    palette: meta.palette,
    created_at: now,
  });

  const settings = readSettings(store);
  const totalSignals = store.count(COLLECTIONS.SIGNALS, { user_id: userId });
  const profile = loadTasteProfile(store, userId);

  const newSinceLastRecompute = totalSignals - (profile.signal_count ?? 0);
  if (newSinceLastRecompute >= 10) {
    recomputeProfile(store, userId, settings);
    return { profile_recomputed: true, total_signals: totalSignals };
  }
  return { profile_recomputed: false, total_signals: totalSignals };
}

export function recomputeProfile(
  store: AppDataStore,
  userId: string,
  settings: AppSettings = DEFAULT_SETTINGS,
): TasteProfile {
  const signals = store.query<TasteSignalRow>(COLLECTIONS.SIGNALS, {
    filter: { user_id: userId },
    limit: 5000,
  });
  const themeWeights = new Map<string, number>();
  const styleWeights = new Map<string, number>();
  const paletteAcc = new Map<string, number>();
  const dislikedThemes = new Map<string, number>();

  for (const s of signals) {
    if (s.signal === 1) {
      if (s.theme) themeWeights.set(s.theme, (themeWeights.get(s.theme) ?? 0) + 1);
      if (s.style) styleWeights.set(s.style, (styleWeights.get(s.style) ?? 0) + 1);
      if (s.palette) paletteAcc.set(s.palette, (paletteAcc.get(s.palette) ?? 0) + 1);
    } else if (s.theme) {
      dislikedThemes.set(s.theme, (dislikedThemes.get(s.theme) ?? 0) + 1);
    }
  }

  const total = signals.length;
  const denom = Math.max(1, total);

  const profile: TasteProfile = {
    version: 1,
    signal_count: total,
    stage: chooseStage(total, settings),
    liked_themes: topN(themeWeights, 20).map(([theme, w]) => ({ theme, weight: w / denom })),
    liked_styles: topN(styleWeights, 10).map(([style, w]) => ({ style, weight: w / denom })),
    liked_palettes: topN(paletteAcc, 10)
      .map(([key, w]) => {
        try {
          return { hex: JSON.parse(key) as string[], weight: w / denom };
        } catch {
          return { hex: [] as string[], weight: 0 };
        }
      })
      .filter((p) => p.hex.length > 0),
    disliked_themes: topN(dislikedThemes, 10).map(([theme, w]) => ({ theme, weight: w / denom })),
    last_recomputed_at: new Date().toISOString(),
  };

  upsertProfileRow(store, userId, profile);
  return profile;
}

export function resetTasteProfile(store: AppDataStore, userId: string): void {
  const signals = store.query<TasteSignalRow>(COLLECTIONS.SIGNALS, {
    filter: { user_id: userId },
    limit: 10000,
  });
  for (const s of signals) store.delete(COLLECTIONS.SIGNALS, s.id);

  const profile = store.query<{ user_id: string }>(COLLECTIONS.PROFILE, {
    filter: { user_id: userId },
    limit: 1,
  })[0];
  if (profile) store.delete(COLLECTIONS.PROFILE, profile.id);
}

function chooseStage(signalCount: number, settings: AppSettings): TasteStage {
  if (signalCount >= settings.min_signals_for_main_strategy) return 'main';
  if (signalCount >= settings.min_signals_for_mixed_strategy) return 'mixed';
  return 'cold_start';
}

function topN<K>(m: Map<K, number>, n: number): Array<[K, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function emptyProfile(): TasteProfile {
  return {
    version: 1,
    signal_count: 0,
    stage: 'cold_start',
    liked_themes: [],
    liked_styles: [],
    liked_palettes: [],
    disliked_themes: [],
  };
}

function upsertProfileRow(store: AppDataStore, userId: string, profile: TasteProfile): void {
  const existing = store.query<{ user_id: string }>(COLLECTIONS.PROFILE, {
    filter: { user_id: userId },
    limit: 1,
  })[0];
  const payload = {
    user_id: userId,
    version: profile.version,
    profile_json: JSON.stringify(profile),
    signal_count: profile.signal_count,
    stage: profile.stage,
    last_recomputed_at: profile.last_recomputed_at,
  };
  if (existing) {
    store.update(COLLECTIONS.PROFILE, existing.id, payload);
  } else {
    store.create(COLLECTIONS.PROFILE, payload);
  }
}

function readSettings(store: AppDataStore): AppSettings {
  const row = store.query<AppSettings>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
  if (!row) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...row };
}
