import { listMemoryV2Entries, parseMemoryV2Tags } from './store';
import type { MemoryV2Entry, MemoryV2Kind } from './types';

export interface MemoryV2ReflectionIssue {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'duplicate' | 'conflict' | 'resource' | 'stale' | 'candidate' | 'scope';
  title: string;
  detail: string;
  memoryIds: string[];
}

export interface MemoryV2ReflectionReport {
  generatedAt: string;
  stats: {
    total: number;
    active: number;
    candidates: number;
    resourcesNeedingVault: number;
    byKind: Record<MemoryV2Kind, number>;
  };
  issues: MemoryV2ReflectionIssue[];
}


function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 80);
}

function words(value: string): Set<string> {
  const en = value.toLowerCase().split(/[^a-z0-9_]+/g).filter((item) => item.length >= 3);
  const zh = value.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return new Set([...en, ...zh]);
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count += 1;
  }
  return count / Math.min(a.size, b.size);
}

function hasPositiveRule(text: string): boolean {
  return /(要|必须|优先|应该|喜欢|always|prefer|required)/i.test(text);
}

function hasNegativeRule(text: string): boolean {
  return /(不要|禁止|避免|不能|不允许|never|do not|don't)/i.test(text);
}

export function buildMemoryV2ReflectionReport(): MemoryV2ReflectionReport {
  const entries = listMemoryV2Entries({ includeArchived: true, status: 'all', limit: 1000 });
  const activeEntries = entries.filter((entry) => entry.status === 'active');
  const issues: MemoryV2ReflectionIssue[] = [];

  const byKind: Record<MemoryV2Kind, number> = {
    task: 0,
    people: 0,
    resource: 0,
    capability: 0,
    reflection: 0,
  };
  for (const entry of entries) byKind[entry.kind] += 1;

  const duplicateMap = new Map<string, MemoryV2Entry[]>();
  for (const entry of activeEntries) {
    const key = `${entry.kind}:${entry.scope_type}:${entry.scope_key}:${normalizeKey(entry.body || entry.title)}`;
    if (!key.endsWith(':')) {
      const list = duplicateMap.get(key) || [];
      list.push(entry);
      duplicateMap.set(key, list);
    }
  }
  for (const list of duplicateMap.values()) {
    if (list.length < 2) continue;
    issues.push({
      id: `duplicate:${list[0].id}`,
      severity: 'warning',
      category: 'duplicate',
      title: '发现重复记忆',
      detail: `同一作用域内有 ${list.length} 条内容高度相同的 ${list[0].kind} 记忆，后续睡眠会把它作为自动合并或降权信号。`,
      memoryIds: list.map((entry) => entry.id),
    });
  }

  const comparable = activeEntries.filter((entry) => entry.kind === 'people' || entry.kind === 'task');
  for (let i = 0; i < comparable.length; i += 1) {
    for (let j = i + 1; j < comparable.length; j += 1) {
      const left = comparable[i];
      const right = comparable[j];
      if (left.scope_type !== right.scope_type || left.scope_key !== right.scope_key) continue;
      const leftText = `${left.title} ${left.body}`;
      const rightText = `${right.title} ${right.body}`;
      if (!(hasPositiveRule(leftText) && hasNegativeRule(rightText)) && !(hasNegativeRule(leftText) && hasPositiveRule(rightText))) {
        continue;
      }
      if (overlap(words(leftText), words(rightText)) < 0.25) continue;
      issues.push({
        id: `conflict:${left.id}:${right.id}`,
        severity: 'warning',
        category: 'conflict',
        title: '可能存在冲突记忆',
        detail: '两条记忆在同一作用域内表达了相近主题，但一个是正向要求，一个是否定边界。执行时会优先采用更具体、更新的记忆，必要时再追问用户。',
        memoryIds: [left.id, right.id],
      });
    }
  }

  for (const entry of activeEntries) {
    if (entry.kind === 'resource' && entry.sensitivity === 'secret_ref_required' && !entry.secret_ref) {
      issues.push({
        id: `resource:${entry.id}`,
        severity: 'critical',
        category: 'resource',
        title: '资源需要 Vault 引用',
        detail: '这条资源记忆涉及敏感值，普通记忆已隐藏原文。执行路径需要用到时会从 Vault 读取；如果缺少凭证，再向用户索取。',
        memoryIds: [entry.id],
      });
    }
    if (entry.scope_type !== 'user' && entry.scope_type !== 'main_agent' && !entry.scope_key) {
      issues.push({
        id: `scope:${entry.id}`,
        severity: 'critical',
        category: 'scope',
        title: '记忆缺少作用域',
        detail: '非全局记忆必须绑定项目、会话、模块或实体，否则注入时容易污染其他场景。',
        memoryIds: [entry.id],
      });
    }
    const updatedAt = Date.parse(entry.updated_at.replace(' ', 'T'));
    if (Number.isFinite(updatedAt)) {
      const days = Math.floor((Date.now() - updatedAt) / 86_400_000);
      if (days >= 45 && entry.hit_count === 0) {
        issues.push({
          id: `stale:${entry.id}`,
          severity: 'info',
          category: 'stale',
          title: '长期未使用记忆',
          detail: `这条记忆 ${days} 天没有被使用，后续注入会降低优先级。标签：${parseMemoryV2Tags(entry.tags).join(', ') || '无'}`,
          memoryIds: [entry.id],
        });
      }
    }
  }

  const candidates = entries.filter((entry) => entry.status === 'candidate');
  if (candidates.length > 0) {
    issues.push({
      id: 'candidate:pending',
      severity: 'info',
      category: 'candidate',
      title: '候选记忆待沉淀',
      detail: `当前有 ${candidates.length} 条候选记忆，后续睡眠会继续聚合、去重并沉淀为稳定行动上下文。`,
      memoryIds: candidates.slice(0, 20).map((entry) => entry.id),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      total: entries.length,
      active: activeEntries.length,
      candidates: candidates.length,
      resourcesNeedingVault: activeEntries.filter((entry) => entry.kind === 'resource' && entry.sensitivity === 'secret_ref_required' && !entry.secret_ref).length,
      byKind,
    },
    issues,
  };
}
