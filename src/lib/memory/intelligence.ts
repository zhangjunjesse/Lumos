import { z } from 'zod';
import { parseMessageContent } from '@/types';
import {
  getMessages,
  getSession,
  getSetting,
  setSetting,
  upsertMemory,
  listMemoriesForContext,
  createMemoryIntelligenceEvent,
  countMemoryIntelligenceEventsByDay,
  getLatestMemoryIntelligenceEventForSession,
} from '@/lib/db';
import { generateTextFromProvider } from '@/lib/text-generator';
import type { MemoryCategory, MemoryScope, MemoryRecord } from '@/lib/db/memories';
import { BUILTIN_CLAUDE_MODEL_IDS, resolveBuiltInClaudeModelId } from '@/lib/model-metadata';

export type MemoryTriggerReason =
  | 'idle'
  | 'session_switch'
  | 'weak_signal'
  | 'manual'
  | 'api'
  | 'post_reply';

export interface WeakMemorySignal {
  matched: boolean;
  score: number;
  labels: string[];
}

export interface MemoryIntelligenceConfig {
  enabled: boolean;
  providerId: string;
  shouldModel: string;
  extractModel: string;
  shouldPrompt: string;
  extractPrompt: string;
  confidenceThreshold: number;
  cooldownSeconds: number;
  dailyBudget: number;
  maxItemsPerRun: number;
  windowMessages: number;
  triggerSessionSwitchEnabled: boolean;
  triggerIdleEnabled: boolean;
  triggerWeakSignalEnabled: boolean;
  idleTimeoutMs: number;
}

export interface MemoryIntelligenceCandidate {
  content: string;
  category: MemoryCategory;
  scope: MemoryScope;
  confidence: number;
  tags: string[];
  evidence: string;
}

export interface MemoryIntelligenceRunResult {
  ok: boolean;
  trigger: MemoryTriggerReason;
  outcome: 'saved' | 'no_memory' | 'skipped' | 'disabled' | 'cooldown' | 'budget_limited' | 'no_context' | 'error' | 'preview';
  reason: string;
  eventId?: string;
  shouldRemember?: boolean;
  shouldConfidence?: number;
  candidateCount: number;
  savedCount: number;
  tokenEstimate: number;
  candidates: MemoryIntelligenceCandidate[];
  extractedMemories?: Array<{
    content: string;
    category: string;
    scope: string;
    evidence: string;
  }>;
}

const DEFAULT_SHOULD_PROMPT = [
  '你是 Lumos 的“记忆守门员（Memory Gatekeeper）”。',
  '任务：判断 recent_conversation 中是否存在应写入长期记忆的信息。',
  '<判定原则>',
  '1) 只保留稳定、可复用、会影响未来协作的信息。',
  '2) 优先：用户偏好、边界约束、长期事实、可复用流程。',
  '3) 若内容只对当前轮有效、或不确定其长期价值，则不记忆。',
  '</判定原则>',
  '<必须拒绝>',
  '- 临时任务细节、一次性上下文、寒暄闲聊。',
  '- 任何密钥/令牌/密码/私密身份信息。',
  '- 没有明确证据支撑的推测。',
  '</必须拒绝>',
  '<冲突处理>',
  '如果历史偏好与当前用户明确指令冲突，始终以“当前指令”为准。',
  '</冲突处理>',
  '<输出格式>',
  '仅输出一个 JSON 对象，不要 Markdown，不要解释：',
  '{"should_remember":boolean,"confidence":0..1,"reason":"<=120字","priority":"low|medium|high"}',
  '</输出格式>',
].join('\n');

const DEFAULT_EXTRACT_PROMPT = [
  '你是 Lumos 的“记忆提炼器（Memory Distiller）”。',
  '任务：从 recent_conversation 中提取高价值长期记忆，输出结构化 JSON。',
  '<提炼规则>',
  '1) 每条记忆应可独立复用，避免“这次/刚刚/上面提到”这类指代。',
  '2) content 用短句，4~180 字；必须具体、可执行、无敏感信息。',
  '3) 仅输出确定性高的信息；不确定就不要提取。',
  '4) 去重：与 existing_memories 语义重复时跳过。',
  '5) 总数不超过 6 条，按重要性排序。',
  '</提炼规则>',
  '<字段约束>',
  'category 仅可为 preference|constraint|fact|workflow|other。',
  'scope 仅可为 global|project|session。',
  'confidence 为 0..1。',
  'tags 建议 1~4 个短标签。',
  '</字段约束>',
  '<输出格式>',
  '仅输出一个 JSON 对象，不要 Markdown，不要解释：',
  '{"memories":[{"content":"","category":"","scope":"","confidence":0.0,"tags":[""],"evidence":""}],"summary":""}',
  '</输出格式>',
].join('\n');

const SHOULD_SCHEMA = z.object({
  should_remember: z.boolean(),
  confidence: z.number().min(0).max(1).default(0.5),
  reason: z.string().max(240).default(''),
  priority: z.enum(['low', 'medium', 'high']).default('low'),
});

const EXTRACT_ITEM_SCHEMA = z.object({
  content: z.string().min(4).max(260),
  category: z.enum(['preference', 'constraint', 'fact', 'workflow', 'other']).default('other'),
  scope: z.enum(['global', 'project', 'session']).default('project'),
  confidence: z.number().min(0).max(1).default(0.7),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
  evidence: z.string().max(320).default(''),
});

const EXTRACT_SCHEMA = z.object({
  memories: z.array(EXTRACT_ITEM_SCHEMA).max(12).default([]),
  summary: z.string().max(240).default(''),
});

const WEAK_SIGNAL_RULES: Array<{ label: string; score: number; pattern: RegExp }> = [
  {
    label: 'anger',
    score: 3,
    pattern: /生气|愤怒|气死|气炸|烦死|受够|抓狂|崩溃|垃圾|太烂|怎么总是|总是这样|why(?:\s+is|\s+does)?\s+.*always/i,
  },
  {
    label: 'confusion',
    score: 2,
    pattern: /困惑|不懂|看不懂|怎么回事|为什么|啥情况|不对劲|不对|wtf|confused|don't understand|why\b/i,
  },
  {
    label: 'helpless',
    score: 3,
    pattern: /无助|救命|帮帮我|卡住了|做不下去|太难了|stuck|helpless|frustrated/i,
  },
];

const SENSITIVE_PATTERNS: RegExp[] = [
  /api[_-]?key|access[_-]?token|secret|password|passwd|私钥|密钥|令牌/i,
  /BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY/i,
  /\b[A-Za-z0-9_]{24,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT-like
  /\b\d{15,19}\b/, // bank-like number
];

const activeRuns = new Map<string, number>();

function getBoolSetting(key: string, fallback: boolean): boolean {
  const value = (getSetting(key) || '').trim().toLowerCase();
  if (!value) return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

function getIntSetting(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(getSetting(key) || '');
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function getFloatSetting(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(getSetting(key) || '');
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function getTextSetting(key: string, fallback: string): string {
  const value = (getSetting(key) || '').trim();
  return value || fallback;
}

function resolveRecommendedMemoryModel(): string {
  const candidates = [
    (getSetting('default_model') || '').trim(),
    (getSetting('memory_intelligence_extract_model') || '').trim(),
    (getSetting('memory_intelligence_should_model') || '').trim(),
    BUILTIN_CLAUDE_MODEL_IDS.sonnet,
  ];
  for (const candidate of candidates) {
    if (candidate) return resolveBuiltInClaudeModelId(candidate, 'sonnet');
  }
  return BUILTIN_CLAUDE_MODEL_IDS.sonnet;
}

function normalizeLeadingComments(text: string): string {
  let value = text;
  while (true) {
    const match = value.match(/^<!--[\s\S]*?-->\s*/);
    if (!match) break;
    value = value.slice(match[0].length);
  }
  return value.trim();
}

function extractMessageText(rawContent: string): string {
  const stripped = normalizeLeadingComments(rawContent);
  const blocks = parseMessageContent(stripped);
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim()) {
      parts.push(block.text.trim());
    }
    if (block.type === 'tool_result' && typeof block.content === 'string') {
      const result = block.content.trim();
      if (result) parts.push(`[tool_result] ${result}`);
    }
  }
  const joined = parts.join('\n').replace(/\s+\n/g, '\n').trim();
  return joined.length > 1200 ? `${joined.slice(0, 1200)}...` : joined;
}

function buildConversationWindow(sessionId: string, limit: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  const { messages } = getMessages(sessionId, { limit: Math.max(2, Math.min(limit, 40)) });
  return messages
    .map((item) => ({
      role: item.role,
      content: extractMessageText(item.content),
    }))
    .filter((item) => item.content.length > 0);
}

function buildTranscript(windowMessages: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  return windowMessages
    .map((item, idx) => `${idx + 1}. ${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`)
    .join('\n');
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    // continue
  }

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = withoutFence.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeMemoryText(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function inferShouldRememberFromText(raw: string): {
  should_remember: boolean;
  confidence: number;
  reason: string;
  priority: 'low' | 'medium' | 'high';
} | null {
  const text = raw.trim();
  if (!text) return null;

  const positive =
    /\btrue\b|需要记忆|建议记忆|应当记忆|值得记忆|需要保存|应该保存|should[_\s-]?remember/i.test(text);
  const negative =
    /\bfalse\b|不需要记忆|无需记忆|不值得记忆|无需保存|不应保存|no[_\s-]?memory|don't remember/i.test(text);

  if (!positive && !negative) return null;
  const should = positive && !negative;

  const numberMatch = text.match(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/);
  const confidence = numberMatch ? Math.max(0, Math.min(1, Number(numberMatch[1]))) : (should ? 0.66 : 0.5);

  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const reason = firstLine.slice(0, 120);
  const priority: 'low' | 'medium' | 'high' = should ? 'medium' : 'low';

  return {
    should_remember: should,
    confidence,
    reason,
    priority,
  };
}

function normalizeTags(tags: string[]): string[] {
  const unique = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase().replace(/\s+/g, '-');
    if (!normalized) continue;
    unique.add(normalized);
    if (unique.size >= 10) break;
  }
  return Array.from(unique);
}

function isSensitiveContent(content: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(content));
}

function shouldSkipByTrigger(config: MemoryIntelligenceConfig, trigger: MemoryTriggerReason): boolean {
  if (trigger === 'idle' && !config.triggerIdleEnabled) return true;
  if (trigger === 'session_switch' && !config.triggerSessionSwitchEnabled) return true;
  if (trigger === 'weak_signal' && !config.triggerWeakSignalEnabled) return true;
  return false;
}

function estimateTokens(...chunks: string[]): number {
  const totalChars = chunks.reduce((acc, item) => acc + item.length, 0);
  return Math.max(1, Math.ceil(totalChars / 4));
}

function acquireRunLock(sessionId: string): boolean {
  const normalized = sessionId.trim();
  if (!normalized) return false;
  const now = Date.now();
  const last = activeRuns.get(normalized) || 0;
  if (now - last < 60_000) return false;
  activeRuns.set(normalized, now);
  return true;
}

function releaseRunLock(sessionId: string): void {
  activeRuns.delete(sessionId.trim());
}

function resolveScope(
  requested: MemoryScope,
  projectPath: string,
): MemoryScope {
  if (requested === 'project' && !projectPath) return 'global';
  return requested;
}

function dedupeCandidates(
  candidates: MemoryIntelligenceCandidate[],
  existingMemories: MemoryRecord[],
): MemoryIntelligenceCandidate[] {
  const existingNorm = new Set(
    existingMemories.map((memory) => normalizeMemoryText(memory.content).toLowerCase()),
  );

  const seen = new Set<string>();
  const result: MemoryIntelligenceCandidate[] = [];
  for (const candidate of candidates) {
    const norm = normalizeMemoryText(candidate.content).toLowerCase();
    if (!norm) continue;
    if (existingNorm.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(candidate);
  }
  return result;
}

async function callMemoryModel(params: {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  return generateTextFromProvider({
    providerId: params.providerId || '',
    model: params.model,
    system: params.system,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    abortSignal: AbortSignal.timeout(20_000),
  });
}

function toSqlTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').split('.')[0];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getDefaultMemoryIntelligencePrompts(): {
  shouldPrompt: string;
  extractPrompt: string;
} {
  return {
    shouldPrompt: DEFAULT_SHOULD_PROMPT,
    extractPrompt: DEFAULT_EXTRACT_PROMPT,
  };
}

export function getMemoryIntelligenceConfig(): MemoryIntelligenceConfig {
  const defaults = getDefaultMemoryIntelligencePrompts();
  const recommendedModel = resolveRecommendedMemoryModel();
  return {
    enabled: getBoolSetting('memory_intelligence_enabled', true),
    providerId: getTextSetting('memory_intelligence_provider_id', ''),
    shouldModel: getTextSetting('memory_intelligence_should_model', recommendedModel),
    extractModel: getTextSetting('memory_intelligence_extract_model', recommendedModel),
    shouldPrompt: getTextSetting('memory_intelligence_should_prompt', defaults.shouldPrompt),
    extractPrompt: getTextSetting('memory_intelligence_extract_prompt', defaults.extractPrompt),
    confidenceThreshold: getFloatSetting('memory_intelligence_confidence_threshold', 0.64, 0.2, 0.98),
    cooldownSeconds: getIntSetting('memory_intelligence_cooldown_seconds', 300, 0, 7200),
    dailyBudget: getIntSetting('memory_intelligence_daily_budget', 24, 1, 500),
    maxItemsPerRun: getIntSetting('memory_intelligence_max_items_per_run', 3, 1, 8),
    windowMessages: getIntSetting('memory_intelligence_window_messages', 14, 4, 40),
    triggerSessionSwitchEnabled: getBoolSetting('memory_intelligence_trigger_session_switch_enabled', true),
    triggerIdleEnabled: getBoolSetting('memory_intelligence_trigger_idle_enabled', true),
    triggerWeakSignalEnabled: getBoolSetting('memory_intelligence_trigger_weak_signal_enabled', true),
    idleTimeoutMs: getIntSetting('memory_intelligence_idle_timeout_ms', 120000, 10000, 600000),
  };
}

export function detectWeakMemorySignal(text: string): WeakMemorySignal {
  const content = text.trim();
  if (!content) return { matched: false, score: 0, labels: [] };

  let score = 0;
  const labels: string[] = [];
  for (const rule of WEAK_SIGNAL_RULES) {
    if (rule.pattern.test(content)) {
      score += rule.score;
      labels.push(rule.label);
    }
  }

  return {
    matched: score >= 2,
    score,
    labels,
  };
}

function buildShouldPrompt(params: {
  trigger: MemoryTriggerReason;
  projectPath: string;
  transcript: string;
  existingMemories: MemoryRecord[];
}): string {
  const memoryPreview = params.existingMemories
    .slice(0, 20)
    .map((memory, idx) => `${idx + 1}. [${memory.category}/${memory.scope}] ${memory.content}`)
    .join('\n');

  return [
    `trigger: ${params.trigger}`,
    params.projectPath ? `project_path: ${params.projectPath}` : 'project_path: <none>',
    '',
    'recent_conversation:',
    params.transcript || '<empty>',
    '',
    'existing_memories:',
    memoryPreview || '<none>',
    '',
    '请只输出 JSON。',
  ].join('\n');
}

function buildExtractPrompt(params: {
  trigger: MemoryTriggerReason;
  projectPath: string;
  transcript: string;
  existingMemories: MemoryRecord[];
  reason: string;
}): string {
  const memoryPreview = params.existingMemories
    .slice(0, 30)
    .map((memory, idx) => `${idx + 1}. [${memory.category}/${memory.scope}] ${memory.content}`)
    .join('\n');

  return [
    `trigger: ${params.trigger}`,
    `should_reason: ${params.reason || '<none>'}`,
    params.projectPath ? `project_path: ${params.projectPath}` : 'project_path: <none>',
    '',
    'recent_conversation:',
    params.transcript || '<empty>',
    '',
    'existing_memories:',
    memoryPreview || '<none>',
    '',
    '请只输出 JSON。',
  ].join('\n');
}

export async function runMemoryIntelligenceForSession(params: {
  sessionId: string;
  trigger: MemoryTriggerReason;
  force?: boolean;
  dryRun?: boolean;
}): Promise<MemoryIntelligenceRunResult> {
  const sessionId = params.sessionId.trim();
  const trigger = params.trigger;

  const baseResult: MemoryIntelligenceRunResult = {
    ok: false,
    trigger,
    outcome: 'skipped',
    reason: '',
    candidateCount: 0,
    savedCount: 0,
    tokenEstimate: 0,
    candidates: [],
  };

  if (!sessionId) {
    return {
      ...baseResult,
      outcome: 'no_context',
      reason: 'missing_session',
    };
  }

  const config = getMemoryIntelligenceConfig();
  const session = getSession(sessionId);
  const projectPath = (session?.sdk_cwd || session?.working_directory || '').trim();
  const memorySystemEnabled = getSetting('memory_system_enabled') !== 'false';
  const force = Boolean(params.force);
  const dryRun = Boolean(params.dryRun);
  const shouldModel = config.shouldModel;
  const extractModel = config.extractModel;

  const createEvent = (outcome: MemoryIntelligenceRunResult['outcome'], reason: string, patch?: Partial<MemoryIntelligenceRunResult>) => {
    const event = createMemoryIntelligenceEvent({
      sessionId,
      trigger,
      outcome,
      reason,
      candidateCount: patch?.candidateCount || 0,
      savedCount: patch?.savedCount || 0,
      tokenEstimate: patch?.tokenEstimate || 0,
      shouldModel,
      extractModel,
      details: {
        dryRun,
        force,
        shouldRemember: patch?.shouldRemember,
        shouldConfidence: patch?.shouldConfidence,
      },
    });
    return {
      ...baseResult,
      ...patch,
      ok: outcome === 'saved' || outcome === 'no_memory' || outcome === 'skipped',
      outcome,
      reason,
      eventId: event.id,
    } as MemoryIntelligenceRunResult;
  };

  if (!session) {
    return createEvent('no_context', 'session_not_found');
  }

  if (!memorySystemEnabled) {
    return createEvent('disabled', 'memory_system_disabled');
  }

  if (!config.enabled && !force) {
    return createEvent('disabled', 'memory_intelligence_disabled');
  }

  if (!force && shouldSkipByTrigger(config, trigger)) {
    return createEvent('skipped', `trigger_${trigger}_disabled`);
  }

  if (!acquireRunLock(sessionId)) {
    return createEvent('cooldown', 'run_lock_active');
  }

  try {
    const today = todayIso();
    if (!force) {
      const usedCount = countMemoryIntelligenceEventsByDay(today);
      if (usedCount >= config.dailyBudget) {
        return createEvent('budget_limited', 'daily_budget_reached');
      }

      if (config.cooldownSeconds > 0) {
        const latest = getLatestMemoryIntelligenceEventForSession(sessionId);
        if (latest) {
          const last = Date.parse(latest.created_at.replace(' ', 'T'));
          if (Number.isFinite(last)) {
            const elapsed = Date.now() - last;
            if (elapsed < config.cooldownSeconds * 1000) {
              return createEvent('cooldown', 'session_cooldown_active');
            }
          }
        }
      }
    }

    const windowMessages = buildConversationWindow(sessionId, config.windowMessages);
    if (windowMessages.length < 2) {
      return createEvent('no_context', 'not_enough_messages');
    }

    const transcript = buildTranscript(windowMessages);
    const existingMemories = listMemoriesForContext({
      sessionId,
      projectPath,
      limit: 60,
    });

    const shouldPrompt = buildShouldPrompt({
      trigger,
      projectPath,
      transcript,
      existingMemories,
    });

    const shouldRaw = await callMemoryModel({
      providerId: config.providerId,
      model: shouldModel,
      system: config.shouldPrompt,
      prompt: shouldPrompt,
      maxTokens: 480,
    });

    const shouldParsed = SHOULD_SCHEMA.safeParse(parseJsonObject(shouldRaw));
    const shouldData = shouldParsed.success
      ? shouldParsed.data
      : inferShouldRememberFromText(shouldRaw);
    if (!shouldData) {
      return createEvent('no_memory', 'should_parse_failed', {
        tokenEstimate: estimateTokens(config.shouldPrompt, shouldPrompt, shouldRaw),
      });
    }

    const shouldRemember = shouldData.should_remember;
    const shouldConfidence = shouldData.confidence;
    const preTokenEstimate = estimateTokens(config.shouldPrompt, shouldPrompt, shouldRaw);

    if (!shouldRemember || shouldConfidence < config.confidenceThreshold) {
      return createEvent('no_memory', 'should_remember_rejected', {
        shouldRemember,
        shouldConfidence,
        tokenEstimate: preTokenEstimate,
      });
    }

    const extractPrompt = buildExtractPrompt({
      trigger,
      projectPath,
      transcript,
      existingMemories,
      reason: shouldData.reason || '',
    });

    const extractRaw = await callMemoryModel({
      providerId: config.providerId,
      model: extractModel,
      system: config.extractPrompt,
      prompt: extractPrompt,
      maxTokens: 900,
    });

    const extractParsed = EXTRACT_SCHEMA.safeParse(parseJsonObject(extractRaw));
    if (!extractParsed.success) {
      return createEvent('no_memory', 'extract_parse_failed', {
        shouldRemember,
        shouldConfidence,
        tokenEstimate: preTokenEstimate + estimateTokens(config.extractPrompt, extractPrompt, extractRaw),
      });
    }

    const filtered: MemoryIntelligenceCandidate[] = extractParsed.data.memories
      .map((item) => {
        const normalizedContent = normalizeMemoryText(item.content);
        const normalizedScope = resolveScope(item.scope, projectPath);
        return {
          content: normalizedContent,
          category: item.category,
          scope: normalizedScope,
          confidence: item.confidence,
          tags: normalizeTags(item.tags || []),
          evidence: item.evidence.trim(),
        } as MemoryIntelligenceCandidate;
      })
      .filter((item) => item.content.length >= 4)
      .filter((item) => item.confidence >= config.confidenceThreshold)
      .filter((item) => !isSensitiveContent(item.content))
      .slice(0, config.maxItemsPerRun);

    const deduped = dedupeCandidates(filtered, existingMemories).slice(0, config.maxItemsPerRun);
    const tokenEstimate = preTokenEstimate + estimateTokens(config.extractPrompt, extractPrompt, extractRaw);

    if (deduped.length === 0) {
      return createEvent('no_memory', 'all_candidates_filtered', {
        shouldRemember,
        shouldConfidence,
        candidateCount: filtered.length,
        tokenEstimate,
        candidates: [],
      });
    }

    if (dryRun) {
      return createEvent('skipped', 'dry_run', {
        shouldRemember,
        shouldConfidence,
        candidateCount: deduped.length,
        tokenEstimate,
        candidates: deduped,
      });
    }

    let savedCount = 0;
    for (const candidate of deduped) {
      const saved = upsertMemory({
        sessionId,
        projectPath,
        scope: candidate.scope,
        category: candidate.category,
        content: candidate.content,
        evidence: candidate.evidence,
        tags: candidate.tags,
        source: `llm_${trigger}`,
        confidence: candidate.confidence,
      });
      if (saved?.id) savedCount += 1;
    }

    if (savedCount <= 0) {
      return createEvent('no_memory', 'upsert_no_change', {
        shouldRemember,
        shouldConfidence,
        candidateCount: deduped.length,
        tokenEstimate,
        candidates: deduped,
      });
    }

    setSetting('memory_intelligence_last_run_at', toSqlTimestamp(new Date()));

    return createEvent('saved', 'ok', {
      shouldRemember,
      shouldConfidence,
      candidateCount: deduped.length,
      savedCount,
      tokenEstimate,
      candidates: deduped,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown_error';
    return createEvent('error', reason.slice(0, 180));
  } finally {
    releaseRunLock(sessionId);
  }
}
