import {
  listMemoriesForContext,
  touchMemoriesUsage,
  upsertMemory,
  type MemoryCategory,
  type MemoryRecord,
  type MemoryScope,
} from '@/lib/db/memories';
import { getSetting } from '@/lib/db/sessions';
import { detectMemoryConflict } from './conflict-detection';
import { logMemoryUsage } from '@/lib/db/memory-usage-log';

const MEMORY_TRIGGER_PATTERNS: RegExp[] = [
  /(?:^|\s)(记住|记一下|记得|以后记得|下次记得)/i,
  /(?:^|\s)(always|never|remember|from now on|prefer)\b/i,
];

const PREFIX_CLEANUP_PATTERNS: RegExp[] = [
  /^(请|麻烦)?(帮我)?(记住|记一下|记得)(一下)?[:：,\s]*/i,
  /^(以后|下次)(请)?(记得|要|不要)[:：,\s]*/i,
  /^(always|never|remember|from now on)\s*[:,-]?\s*/i,
];

const TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'typescript', pattern: /\btypescript\b|\bts\b|TypeScript/i },
  { tag: 'testing', pattern: /测试|test|jest|vitest|playwright/i },
  { tag: 'style', pattern: /代码风格|lint|format|prettier|eslint/i },
  { tag: 'package-manager', pattern: /npm|pnpm|yarn|bun/i },
  { tag: 'workflow', pattern: /流程|workflow|步骤|发布|deploy/i },
  { tag: 'security', pattern: /安全|secret|token|权限|permission/i },
];

function isMemorySystemEnabled(): boolean {
  return getSetting('memory_system_enabled') !== 'false';
}

function getMemoryContextLimit(): number {
  const raw = getSetting('memory_context_max_items');
  const parsed = Number(raw || '');
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(Math.floor(parsed), 20));
}

function normalizeProjectPath(projectPath?: string): string {
  return projectPath?.trim() || '';
}

function shouldCapture(input: string): boolean {
  const normalized = input.trim();
  if (!normalized || normalized.length < 4) return false;
  return MEMORY_TRIGGER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeMemoryContent(input: string): string {
  let value = input.trim();
  for (const pattern of PREFIX_CLEANUP_PATTERNS) {
    value = value.replace(pattern, '');
  }
  value = value.replace(/\s+/g, ' ').trim();
  if (value.length > 240) {
    value = `${value.slice(0, 237)}...`;
  }
  return value;
}

function inferCategory(content: string): MemoryCategory {
  if (/(不要|禁止|别|never|do not|don't)/i.test(content)) return 'constraint';
  if (/(偏好|喜欢|习惯|prefer|always)/i.test(content)) return 'preference';
  if (/(流程|步骤|workflow|发布|部署|测试)/i.test(content)) return 'workflow';
  if (/(是|使用|项目|架构|技术栈|stack)/i.test(content)) return 'fact';
  return 'other';
}

function inferTags(content: string): string[] {
  const tags: string[] = [];
  for (const rule of TAG_RULES) {
    if (rule.pattern.test(content)) tags.push(rule.tag);
  }
  return tags;
}

function extractKeywords(prompt: string): string[] {
  const enTokens = prompt
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const zhTokens = prompt.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const uniq = new Set<string>();
  for (const token of [...enTokens, ...zhTokens]) {
    uniq.add(token);
    if (uniq.size >= 30) break;
  }
  return Array.from(uniq);
}

function scoreMemory(record: MemoryRecord, keywords: string[]): number {
  let score = 0;
  if (record.is_pinned) score += 120;
  if (record.scope === 'project') score += 12;
  if (record.scope === 'global') score += 6;
  if (record.category === 'constraint') score += 8;

  const haystack = `${record.content} ${record.tags}`.toLowerCase();
  for (const keyword of keywords) {
    if (haystack.includes(keyword.toLowerCase())) {
      score += keyword.length >= 4 ? 16 : 8;
    }
  }

  const ts = Date.parse(record.updated_at.replace(' ', 'T'));
  if (Number.isFinite(ts)) {
    const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
    score += Math.max(0, 20 - Math.min(days, 20));
  }

  return score;
}

function formatMemoryContext(memories: MemoryRecord[]): string {
  if (memories.length === 0) return '';

  const lines = memories.map((memory, idx) => {
    return `${idx + 1}. [${memory.category}] ${memory.content}`;
  });

  return [
    '<lumos_memory>',
    'Use the following persisted memory only when relevant.',
    'If it conflicts with the current user request, follow the current request.',
    ...lines,
    '</lumos_memory>',
  ].join('\n');
}

export function captureExplicitMemoryFromUserInput(params: {
  sessionId: string;
  projectPath?: string;
  userInput: string;
}): MemoryRecord | null {
  if (!isMemorySystemEnabled()) return null;
  if (!shouldCapture(params.userInput)) return null;

  const content = normalizeMemoryContent(params.userInput);
  if (!content || content.length < 4) return null;

  const projectPath = normalizeProjectPath(params.projectPath);
  const scope: MemoryScope = projectPath ? 'project' : 'global';
  const category = inferCategory(content);
  const tags = inferTags(content);

  const record = upsertMemory({
    sessionId: params.sessionId,
    projectPath,
    scope,
    category,
    content,
    evidence: params.userInput,
    tags,
    source: 'user_explicit',
    confidence: 1,
  });

  return record;
}

export function captureExplicitMemoryWithConflictCheck(params: {
  sessionId: string;
  projectPath?: string;
  userInput: string;
}): { memory: MemoryRecord | null; conflict: MemoryRecord | null } {
  if (!isMemorySystemEnabled()) return { memory: null, conflict: null };
  if (!shouldCapture(params.userInput)) return { memory: null, conflict: null };

  const content = normalizeMemoryContent(params.userInput);
  if (!content || content.length < 4) return { memory: null, conflict: null };

  const projectPath = normalizeProjectPath(params.projectPath);
  const scope: MemoryScope = projectPath ? 'project' : 'global';
  const category = inferCategory(content);

  const conflict = detectMemoryConflict({
    content,
    scope,
    category,
    projectPath,
    sessionId: params.sessionId,
  });

  if (conflict) {
    return { memory: null, conflict };
  }

  const tags = inferTags(content);
  const record = upsertMemory({
    sessionId: params.sessionId,
    projectPath,
    scope,
    category,
    content,
    evidence: params.userInput,
    tags,
    source: 'user_explicit',
    confidence: 1,
  });

  return { memory: record, conflict: null };
}

export function buildMemoryContextForPrompt(params: {
  sessionId: string;
  projectPath?: string;
  prompt: string;
  maxItems?: number;
  trackUsage?: boolean;
}): string {
  if (!isMemorySystemEnabled()) return '';
  const prompt = params.prompt.trim();
  if (!prompt) return '';

  const memories = listMemoriesForContext({
    projectPath: normalizeProjectPath(params.projectPath),
    sessionId: params.sessionId,
    limit: 80,
  });
  if (memories.length === 0) return '';

  const keywords = extractKeywords(prompt);
  const ranked = memories
    .map((memory) => ({ memory, score: scoreMemory(memory, keywords) }))
    .sort((a, b) => b.score - a.score);

  const maxItems = Math.max(1, Math.min(params.maxItems ?? getMemoryContextLimit(), 20));
  let selected = ranked.filter((item) => item.score > 0).slice(0, maxItems).map((item) => item.memory);
  if (selected.length === 0) {
    selected = ranked.slice(0, Math.min(3, maxItems)).map((item) => item.memory);
  }

  const context = formatMemoryContext(selected);
  if (!context) return '';

  if (params.trackUsage !== false) {
    try {
      touchMemoriesUsage(selected.map((memory) => memory.id));
      for (const memory of selected) {
        logMemoryUsage(memory.id, params.sessionId, prompt.slice(0, 100));
      }
    } catch {
      // Best effort only.
    }
  }

  return context;
}
