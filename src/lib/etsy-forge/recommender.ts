// Recommender — 推送算法
// 冷启动：FALLBACK_EVERGREEN_THEMES × 风格多样化铺 50
// 常态：60% 贴近偏好 + 30% 趋势新机会 + 10% 风格跳跃（防审美固化）
// 去重：fingerprint hash 与上一批比较，重合的过滤后补
// 注：PRD §6.1 提到 cosine 相似度去重，那是图片向量级别（生成后做）；
//      推送阶段用 fingerprint hash 已经足以避免明显重复。

import crypto from 'node:crypto';
import { FALLBACK_EVERGREEN_THEMES } from './trend-signals';
import {
  type PushSlot,
  type PushSource,
  type TasteProfile,
  type WeeklySignals,
} from './types';

const GENERIC_STYLES = [
  'minimal line art',
  'vintage retro',
  'hand-drawn watercolor',
  'flat illustration',
  'screen print',
  'pen and ink botanical',
  'soft pastel',
  'bold typography',
];

const GENERIC_PALETTES: string[][] = [
  ['#3A5F4A', '#D4A373', '#FAEDCD', '#283618'],
  ['#1D3557', '#457B9D', '#A8DADC', '#F1FAEE'],
  ['#E07A5F', '#F4A261', '#F2E8CF', '#264653'],
  ['#000000', '#FFFFFF', '#E63946'],
  ['#606C38', '#283618', '#FEFAE0', '#DDA15E'],
  ['#FFB4A2', '#E5989B', '#B5838D', '#6D6875'],
];

const GENERIC_COMPOSITIONS = [
  'centered single subject, off-white background',
  'flat-lay arrangement, lots of white space',
  'silhouette mid-action, simple ground line',
  'border frame around central typography',
  'organic illustration with subtle texture',
];

const GENERIC_FORMATS = [
  'centered T-shirt graphic, transparent background',
  'square poster composition, printable at 16x16in',
  'mug wraparound layout, repeating motif',
];

export interface RecommendInput {
  weekly: WeeklySignals;
  taste: TasteProfile;
  lastBatchFingerprints: string[];
  batchSize: number;
}

export interface RecommendResult {
  slots: PushSlot[];
  strategy: TasteProfile['stage'];
  themesUsed: string[];
  signalsStatus: WeeklySignals['status'];
}

export function recommendBatch(input: RecommendInput): RecommendResult {
  const { weekly, taste, lastBatchFingerprints, batchSize } = input;
  const blocked = new Set(lastBatchFingerprints);

  const strategy = taste.stage;
  const buckets = decideBuckets(strategy, batchSize);

  const themePool = buildThemePool(weekly, taste);
  const stylePool = buildStylePool(weekly, taste);
  const palettePool = buildPalettePool(weekly, taste);
  const compositionPool = buildCompositionPool(weekly);

  const slots: PushSlot[] = [];
  const used = new Set<string>();
  const allThemes = new Set<string>();

  for (const [source, count] of Object.entries(buckets) as Array<[PushSource, number]>) {
    const themesForBucket = themePool[source];
    let attempts = 0;
    const maxAttempts = count * 6;
    while (slots.filter((s) => s.source === source).length < count && attempts < maxAttempts) {
      attempts++;
      const theme = sample(themesForBucket);
      const style = sample(stylePool);
      const palette = sample(palettePool);
      const composition = sample(compositionPool);
      const format = sample(GENERIC_FORMATS);
      const fp = fingerprint(theme, style, palette, composition);
      if (used.has(fp) || blocked.has(fp)) continue;
      used.add(fp);
      allThemes.add(theme);
      slots.push({ theme, style, palette, composition, format, source });
    }
  }

  // If under-filled due to dedup, top up with random fallback
  while (slots.length < batchSize) {
    const theme = sample(FALLBACK_EVERGREEN_THEMES).theme;
    const style = sample(stylePool);
    const palette = sample(palettePool);
    const composition = sample(compositionPool);
    const format = sample(GENERIC_FORMATS);
    const fp = fingerprint(theme, style, palette, composition);
    if (used.has(fp) || blocked.has(fp)) {
      slots.push({ theme, style, palette, composition, format, source: 'random' });
    } else {
      used.add(fp);
      allThemes.add(theme);
      slots.push({ theme, style, palette, composition, format, source: 'random' });
    }
    if (slots.length >= batchSize) break;
  }

  return {
    slots,
    strategy,
    themesUsed: [...allThemes],
    signalsStatus: weekly.status,
  };
}

export function fingerprint(theme: string, style: string, palette: string[], composition: string): string {
  const data = `${theme}|${style}|${[...palette].sort().join(',')}|${composition}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function decideBuckets(stage: TasteProfile['stage'], batchSize: number): Record<PushSource, number> {
  if (stage === 'cold_start') {
    return {
      cold_start: batchSize,
      preference: 0,
      trend: 0,
      random: 0,
    };
  }
  if (stage === 'mixed') {
    return {
      cold_start: 0,
      preference: Math.floor(batchSize * 0.4),
      trend: Math.floor(batchSize * 0.4),
      random: batchSize - Math.floor(batchSize * 0.4) - Math.floor(batchSize * 0.4),
    };
  }
  // main: 60 preference / 30 trend / 10 random
  const pref = Math.floor(batchSize * 0.6);
  const trend = Math.floor(batchSize * 0.3);
  return {
    cold_start: 0,
    preference: pref,
    trend,
    random: batchSize - pref - trend,
  };
}

interface ThemePool {
  cold_start: string[];
  preference: string[];
  trend: string[];
  random: string[];
}

function buildThemePool(weekly: WeeklySignals, taste: TasteProfile): ThemePool {
  const evergreen = FALLBACK_EVERGREEN_THEMES.map((t) => t.theme);
  const rising = weekly.rising_themes.map((t) => t.theme).filter(Boolean);
  const liked = taste.liked_themes.map((t) => t.theme).filter(Boolean);
  const disliked = new Set(taste.disliked_themes.map((t) => t.theme));

  const filterDisliked = (arr: string[]) => arr.filter((t) => !disliked.has(t));

  return {
    cold_start: rising.length > 0 ? filterDisliked(rising) : evergreen,
    preference: liked.length > 0 ? liked : filterDisliked(rising.length > 0 ? rising : evergreen),
    trend: filterDisliked(rising.length > 0 ? rising : evergreen),
    random: evergreen, // 不过滤 disliked，给探索机会
  };
}

function buildStylePool(weekly: WeeklySignals, taste: TasteProfile): string[] {
  const liked = taste.liked_styles.map((s) => s.style).filter(Boolean);
  const fromComposition = weekly.composition_trends.map((c) => c.type).filter(Boolean);
  const all = [...liked, ...fromComposition, ...GENERIC_STYLES];
  return [...new Set(all)];
}

function buildPalettePool(weekly: WeeklySignals, taste: TasteProfile): string[][] {
  const fromTaste = taste.liked_palettes.map((p) => p.hex).filter((p) => p.length > 0);
  const fromWeekly = weekly.color_trends.map((p) => p.hex).filter((p) => p.length > 0);
  return [...fromTaste, ...fromWeekly, ...GENERIC_PALETTES];
}

function buildCompositionPool(weekly: WeeklySignals): string[] {
  const fromWeekly = weekly.composition_trends.map((c) => c.type).filter(Boolean);
  return [...fromWeekly, ...GENERIC_COMPOSITIONS];
}

function sample<T>(arr: T[]): T {
  if (arr.length === 0) throw new Error('sample: empty array');
  return arr[Math.floor(Math.random() * arr.length)];
}
