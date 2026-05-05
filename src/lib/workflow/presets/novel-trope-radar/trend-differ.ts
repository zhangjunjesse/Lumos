/**
 * 周间 trope 趋势 diff
 *
 * 纯函数,无 IO,易测试。
 * 输入:本周 + 上周 TropeRecord[]。输出:rising/declining/combinations/...
 */

import type {
  CrossPlatformTrend,
  HookPattern,
  PlatformKey,
  TropeCombination,
  TropeRecord,
  TropeTagDelta,
} from './types';

/** 上下榜入选阈值 — Δ ≥ 3 才算冒头/衰退 */
const SIGNIFICANT_DELTA = 3;
const RISING_TOP_N = 10;
const DECLINING_TOP_N = 10;
const NEW_COMBO_TOP_N = 10;
const CROSS_PLATFORM_TOP_N = 8;
const HOOK_ARCHIVE_TOP_N = 15;

export interface DiffOutput {
  risingTropes: TropeTagDelta[];
  decliningTropes: TropeTagDelta[];
  newCombinations: TropeCombination[];
  crossPlatformSpread: CrossPlatformTrend[];
  hookPatternArchive: HookPattern[];
}

function countTags(records: TropeRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const tag of r.tropeTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

function buildDeltas(
  thisCounts: Map<string, number>,
  lastCounts: Map<string, number>,
): TropeTagDelta[] {
  const allTags = new Set<string>([...thisCounts.keys(), ...lastCounts.keys()]);
  const out: TropeTagDelta[] = [];
  for (const tag of allTags) {
    out.push({
      tag,
      thisWeek: thisCounts.get(tag) ?? 0,
      lastWeek: lastCounts.get(tag) ?? 0,
    });
  }
  return out;
}

function pickRising(deltas: TropeTagDelta[]): TropeTagDelta[] {
  return deltas
    .filter((d) => d.thisWeek - d.lastWeek >= SIGNIFICANT_DELTA)
    .sort((a, b) => (b.thisWeek - b.lastWeek) - (a.thisWeek - a.lastWeek))
    .slice(0, RISING_TOP_N);
}

function pickDeclining(deltas: TropeTagDelta[]): TropeTagDelta[] {
  return deltas
    .filter((d) => d.lastWeek - d.thisWeek >= SIGNIFICANT_DELTA)
    .sort((a, b) => (b.lastWeek - b.thisWeek) - (a.lastWeek - a.thisWeek))
    .slice(0, DECLINING_TOP_N);
}

function comboKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function collectCombos(records: TropeRecord[]): Set<string> {
  const set = new Set<string>();
  for (const r of records) {
    const tags = r.tropeTags;
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        set.add(comboKey(tags[i], tags[j]));
      }
    }
  }
  return set;
}

function findNewCombinations(
  thisWeek: TropeRecord[],
  lastWeek: TropeRecord[],
): TropeCombination[] {
  const lastSet = collectCombos(lastWeek);
  const newPairs = new Map<string, { tags: [string, string]; books: string[] }>();
  for (const r of thisWeek) {
    const tags = r.tropeTags;
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const sorted = [tags[i], tags[j]].sort();
        const key = sorted.join('|');
        if (lastSet.has(key)) continue;
        if (!newPairs.has(key)) {
          newPairs.set(key, { tags: [sorted[0], sorted[1]], books: [] });
        }
        newPairs.get(key)!.books.push(r.bookKey);
      }
    }
  }
  return Array.from(newPairs.values())
    .filter((v) => v.books.length >= 2)
    .map((v) => ({ a: v.tags[0], b: v.tags[1], examples: v.books.slice(0, 3) }))
    .slice(0, NEW_COMBO_TOP_N);
}

function tagPlatformMap(records: TropeRecord[]): Map<string, Set<PlatformKey>> {
  const m = new Map<string, Set<PlatformKey>>();
  for (const r of records) {
    for (const tag of r.tropeTags) {
      if (!m.has(tag)) m.set(tag, new Set());
      m.get(tag)!.add(r.platform);
    }
  }
  return m;
}

function findCrossPlatformSpread(
  thisWeek: TropeRecord[],
  lastWeek: TropeRecord[],
): CrossPlatformTrend[] {
  const lastByTag = tagPlatformMap(lastWeek);
  const thisByTag = tagPlatformMap(thisWeek);
  const out: CrossPlatformTrend[] = [];
  for (const [tag, thisPlatforms] of thisByTag) {
    const lastPlatforms = lastByTag.get(tag) ?? new Set<PlatformKey>();
    if (lastPlatforms.size === 0) continue;
    const newPlatforms = Array.from(thisPlatforms).filter((p) => !lastPlatforms.has(p));
    if (newPlatforms.length === 0) continue;
    out.push({
      tag,
      from: Array.from(lastPlatforms)[0],
      to: newPlatforms,
    });
  }
  return out.slice(0, CROSS_PLATFORM_TOP_N);
}

function buildHookArchive(records: TropeRecord[]): HookPattern[] {
  const counts = new Map<string, { count: number; books: string[] }>();
  for (const r of records) {
    if (!r.openingHookType) continue;
    if (!counts.has(r.openingHookType)) {
      counts.set(r.openingHookType, { count: 0, books: [] });
    }
    const v = counts.get(r.openingHookType)!;
    v.count++;
    if (v.books.length < 3) v.books.push(r.bookKey);
  }
  return Array.from(counts.entries())
    .map(([pattern, v]) => ({ pattern, count: v.count, exampleBookKeys: v.books }))
    .sort((a, b) => b.count - a.count)
    .slice(0, HOOK_ARCHIVE_TOP_N);
}

export function computeTrendDiff(
  thisWeek: TropeRecord[],
  lastWeek: TropeRecord[],
): DiffOutput {
  const deltas = buildDeltas(countTags(thisWeek), countTags(lastWeek));
  return {
    risingTropes: pickRising(deltas),
    decliningTropes: pickDeclining(deltas),
    newCombinations: findNewCombinations(thisWeek, lastWeek),
    crossPlatformSpread: findCrossPlatformSpread(thisWeek, lastWeek),
    hookPatternArchive: buildHookArchive(thisWeek),
  };
}
