import { listMemoryV2Entries, setMemoryV2Status } from './store';
import { isNearDuplicate, memorySamenessOf } from './dedup';
import type { MemoryV2Entry } from './types';

export interface MemoryV2ConsolidationCluster {
  kind: string;
  scope: string;
  keptId: string;
  archivedIds: string[];
}

export interface MemoryV2ConsolidationResult {
  scanned: number;
  clusters: number;
  archived: number;
  details: MemoryV2ConsolidationCluster[];
}

// 同一簇里留哪条：重要度高 > 命中多 > 创建早（保留原始那条，归档后来的复制品）。
function rankForKeep(a: MemoryV2Entry, b: MemoryV2Entry): number {
  if (a.importance !== b.importance) return b.importance - a.importance;
  if (a.hit_count !== b.hit_count) return b.hit_count - a.hit_count;
  return a.created_at <= b.created_at ? -1 : 1;
}

function groupKey(entry: MemoryV2Entry): string {
  return `${entry.kind}|${entry.scope_type}|${entry.scope_key}`;
}

function clusterDuplicates(entries: MemoryV2Entry[]): MemoryV2Entry[][] {
  const used = new Set<string>();
  const clusters: MemoryV2Entry[][] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const seed = entries[i];
    if (used.has(seed.id)) continue;
    const cluster = [seed];
    used.add(seed.id);
    for (let j = i + 1; j < entries.length; j += 1) {
      const candidate = entries[j];
      if (used.has(candidate.id)) continue;
      if (isNearDuplicate(memorySamenessOf(seed), memorySamenessOf(candidate))) {
        cluster.push(candidate);
        used.add(candidate.id);
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }
  return clusters;
}

// 睡眠该真干的活：把同一作用域内的近重复 active 记忆收敛成一条，
// 其余归档（status=archived，可恢复、可审计），让库真的变少。
export function runMemoryV2Consolidation(params: { limit?: number } = {}): MemoryV2ConsolidationResult {
  const entries = listMemoryV2Entries({
    status: 'active',
    limit: Math.max(50, Math.min(params.limit ?? 1000, 1000)),
  });

  const groups = new Map<string, MemoryV2Entry[]>();
  for (const entry of entries) {
    const key = groupKey(entry);
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  }

  const details: MemoryV2ConsolidationCluster[] = [];
  let archived = 0;

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const cluster of clusterDuplicates(list)) {
      const ranked = [...cluster].sort(rankForKeep);
      const [kept, ...losers] = ranked;
      for (const loser of losers) {
        setMemoryV2Status(loser.id, 'archived');
      }
      archived += losers.length;
      details.push({
        kind: kept.kind,
        scope: `${kept.scope_type}:${kept.scope_key}`,
        keptId: kept.id,
        archivedIds: losers.map((entry) => entry.id),
      });
    }
  }

  return { scanned: entries.length, clusters: details.length, archived, details };
}

export interface MemoryV2DecayResult {
  scanned: number;
  archivedIds: string[];
}

const DECAY_MIN_AGE_DAYS = 30;

// 遗忘是特性不是缺陷（Mem0/Generative Agents）：长期低价值记忆要会被忘掉，
// 库才不会只增不减。保守口径——资源/敏感/用过的/重要的/不够老的都不动，可逆。
export function runMemoryV2Decay(params: { minAgeDays?: number; limit?: number } = {}): MemoryV2DecayResult {
  const minAgeDays = Math.max(7, params.minAgeDays ?? DECAY_MIN_AGE_DAYS);
  const cutoff = Date.now() - minAgeDays * 86_400_000;
  const entries = listMemoryV2Entries({
    status: 'active',
    limit: Math.max(50, Math.min(params.limit ?? 1000, 1000)),
  });
  const archivedIds: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'resource') continue;
    if (entry.sensitivity !== 'normal') continue;
    if (entry.importance > 2) continue;
    if (entry.hit_count > 0) continue;
    const created = Date.parse((entry.created_at || '').replace(' ', 'T'));
    if (!Number.isFinite(created) || created > cutoff) continue;
    setMemoryV2Status(entry.id, 'archived');
    archivedIds.push(entry.id);
  }
  return { scanned: entries.length, archivedIds };
}
