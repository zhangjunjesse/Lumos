import crypto from 'crypto';
import { getDb } from '@/lib/db/connection';
import { getSetting, setSetting } from '@/lib/db/sessions';
import { createMemoryV2Entry } from './store';
import type { MemoryV2Entry } from './types';

export type MemoryV2CapabilityEventType = 'skill' | 'mcp';
export type MemoryV2CapabilityEventStatus = 'success' | 'failed' | 'skipped' | 'unknown';
export type MemoryV2CapabilityRiskLevel = 'low' | 'medium' | 'high';
export type MemoryV2CapabilityScanVerdict = 'safe' | 'review_required' | 'blocked' | 'unknown';
export type MemoryV2CapabilityResearchAction =
  | 'third_party_discovered'
  | 'quarantined'
  | 'security_scanned'
  | 'pattern_learned'
  | 'rewrite_planned';

export interface MemoryV2CapabilityEvent {
  id: string;
  capability_type: MemoryV2CapabilityEventType;
  capability_name: string;
  scope: 'builtin' | 'user' | string;
  action: string;
  status: MemoryV2CapabilityEventStatus;
  source: string;
  summary: string;
  detail: string;
  related_id: string;
  version: string;
  metadata: string;
  occurred_at: string;
  _rowid?: number;
}

export interface MemoryV2CapabilityEventInput {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  scope?: 'builtin' | 'user' | string;
  action: string;
  status?: MemoryV2CapabilityEventStatus;
  source?: string;
  summary?: string;
  detail?: string;
  relatedId?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryV2ToolCallEventInput {
  toolName: string;
  status: MemoryV2CapabilityEventStatus;
  sessionId?: string;
  source?: string;
  summary?: string;
  detail?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryV2ThirdPartyCapabilityResearchEventInput {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  action: MemoryV2CapabilityResearchAction;
  status?: MemoryV2CapabilityEventStatus;
  source?: string;
  summary?: string;
  detail?: string;
  candidateUrl?: string;
  quarantinePath?: string;
  scanVerdict?: MemoryV2CapabilityScanVerdict;
  riskLevel?: MemoryV2CapabilityRiskLevel;
  patterns?: string[];
  rewriteTarget?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryV2CapabilityEventSummaryResult {
  scanned: number;
  created: MemoryV2Entry[];
  maxRowId: number;
}

const LAST_ROWID_KEY = 'memory_v2_capability_events_last_rowid';
const SOURCE_TYPE = 'memory_v2_capability_event';
const FIRST_SCAN_DAYS = 7;
const THIRD_PARTY_RESEARCH_ACTIONS = new Set<MemoryV2CapabilityResearchAction>([
  'third_party_discovered',
  'quarantined',
  'security_scanned',
  'pattern_learned',
  'rewrite_planned',
]);

const SENSITIVE_PATTERNS = [
  /(password|passwd|pwd|token|api[_\s-]?key|secret|cookie|authorization|密钥|密码|令牌|登录态)\s*[:：=]\s*([^\s，,；;]+)/ig,
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._-]{12,})\b/ig,
];

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function normalizeText(value: unknown, max = 2000): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function normalizeJson(value?: Record<string, unknown>): string {
  if (!value || typeof value !== 'object') return '{}';
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function redactSensitiveText(value: unknown, max = 2000): string {
  let text = normalizeText(value, max);
  for (const pattern of SENSITIVE_PATTERNS) {
    text = text.replace(pattern, (match, label) => {
      if (typeof label === 'string' && label && !/^sk-/i.test(label) && !/^Bearer/i.test(label)) {
        return `${label}: [已隐藏]`;
      }
      return '[已隐藏敏感值]';
    });
  }
  return text;
}

function normalizeStatus(value: unknown): MemoryV2CapabilityEventStatus {
  if (value === 'success' || value === 'failed' || value === 'skipped' || value === 'unknown') return value;
  return 'success';
}

function normalizeRiskLevel(value: unknown): MemoryV2CapabilityRiskLevel {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
}

function normalizeScanVerdict(value: unknown): MemoryV2CapabilityScanVerdict {
  if (value === 'safe' || value === 'review_required' || value === 'blocked' || value === 'unknown') return value;
  return 'unknown';
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function safeMetadata(input?: Record<string, unknown>): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/password|passwd|pwd|token|api[_-]?key|secret|cookie|authorization|header|env|密钥|密码|令牌|登录态/i.test(key)) {
      result[key] = '[已隐藏]';
      continue;
    }
    if (typeof value === 'string') {
      result[key] = redactSensitiveText(value, 600);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.slice(0, 40).map((item) => typeof item === 'string' ? redactSensitiveText(item, 160) : item);
    } else {
      result[key] = '[object]';
    }
  }
  return result;
}

export function recordMemoryV2CapabilityEvent(input: MemoryV2CapabilityEventInput): MemoryV2CapabilityEvent | null {
  try {
    const capabilityName = normalizeText(input.capabilityName, 160);
    const action = normalizeText(input.action, 80);
    if (!capabilityName || !action) return null;
    const id = crypto.randomBytes(16).toString('hex');
    const occurredAt = nowSql();
    getDb().prepare(
      `INSERT INTO memory_v2_capability_events
        (id, capability_type, capability_name, scope, action, status, source,
         summary, detail, related_id, version, metadata, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.capabilityType,
      capabilityName,
      normalizeText(input.scope || '', 80),
      action,
      normalizeStatus(input.status),
      normalizeText(input.source || 'system', 120),
      redactSensitiveText(input.summary || '', 1000),
      redactSensitiveText(input.detail || '', 2400),
      normalizeText(input.relatedId || '', 160),
      normalizeText(input.version || '', 80),
      normalizeJson(safeMetadata(input.metadata)),
      occurredAt,
    );
    return getMemoryV2CapabilityEvent(id);
  } catch (error) {
    console.warn('[memory-v2] Failed to record capability event:', error instanceof Error ? error.message : error);
    return null;
  }
}

function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (!match) return null;
  return {
    server: match[1].replace(/_/g, '-'),
    tool: match[2],
  };
}

export function recordMemoryV2McpToolCallEvent(input: MemoryV2ToolCallEventInput): MemoryV2CapabilityEvent | null {
  const parsed = parseMcpToolName(input.toolName);
  if (!parsed) return null;
  return recordMemoryV2CapabilityEvent({
    capabilityType: 'mcp',
    capabilityName: parsed.server,
    scope: 'runtime',
    action: 'tool_called',
    status: input.status,
    source: input.source || 'claude-agent-sdk',
    summary: input.summary || `MCP tool ${parsed.tool} ${input.status}`,
    detail: input.detail || '',
    relatedId: input.sessionId || '',
    metadata: {
      sessionId: input.sessionId || '',
      toolName: input.toolName,
      serverName: parsed.server,
      tool: parsed.tool,
      durationMs: input.durationMs,
      ...(input.metadata || {}),
    },
  });
}

export function recordMemoryV2ThirdPartyCapabilityResearchEvent(
  input: MemoryV2ThirdPartyCapabilityResearchEventInput,
): MemoryV2CapabilityEvent | null {
  const scanVerdict = normalizeScanVerdict(input.scanVerdict);
  const riskLevel = normalizeRiskLevel(input.riskLevel);
  const patterns = Array.isArray(input.patterns)
    ? input.patterns.map((pattern) => normalizeText(pattern, 180)).filter(Boolean).slice(0, 20)
    : [];
  return recordMemoryV2CapabilityEvent({
    capabilityType: input.capabilityType,
    capabilityName: input.capabilityName,
    scope: 'third-party-lab',
    action: input.action,
    status: input.status || 'success',
    source: input.source || 'capability-lab',
    summary: input.summary || '第三方能力进入隔离研究流程，未安装也未启用。',
    detail: input.detail || '',
    relatedId: input.candidateUrl || '',
    metadata: {
      researchMode: 'third_party_isolated',
      installState: 'not_installed',
      enabled: false,
      candidateUrl: input.candidateUrl || '',
      quarantinePath: input.quarantinePath || '',
      scanVerdict,
      riskLevel,
      patterns,
      rewriteTarget: input.rewriteTarget || '',
      ...(input.metadata || {}),
    },
  });
}

export function getMemoryV2CapabilityEvent(id: string): MemoryV2CapabilityEvent | null {
  return getDb()
    .prepare('SELECT rowid AS _rowid, * FROM memory_v2_capability_events WHERE id = ?')
    .get(id) as MemoryV2CapabilityEvent | null;
}

export function listMemoryV2CapabilityEvents(params: {
  afterRowId?: number;
  since?: string;
  limit?: number;
} = {}): MemoryV2CapabilityEvent[] {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (params.afterRowId && params.afterRowId > 0) {
    clauses.push('rowid > ?');
    args.push(Math.floor(params.afterRowId));
  }
  if (params.since) {
    clauses.push('occurred_at >= ?');
    args.push(params.since);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(params.limit ?? 300, 1000));
  return getDb().prepare(
    `SELECT rowid AS _rowid, * FROM memory_v2_capability_events
     ${where}
     ORDER BY rowid ASC
     LIMIT ?`,
  ).all(...args, limit) as MemoryV2CapabilityEvent[];
}

function getLastRowId(): number {
  const raw = Number(getSetting(LAST_ROWID_KEY) || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function eventAlreadyCaptured(eventId: string): boolean {
  const row = getDb().prepare(
    'SELECT id FROM memory_v2_entries WHERE source_type = ? AND source_id = ? LIMIT 1',
  ).get(SOURCE_TYPE, eventId) as { id: string } | undefined;
  return Boolean(row);
}

function actionLabel(event: MemoryV2CapabilityEvent): string {
  const noun = event.capability_type === 'mcp' ? 'MCP' : 'Skill';
  const labels: Record<string, string> = {
    created: '已创建',
    updated: '已更新',
    enabled: '已启用',
    disabled: '已停用',
    deleted: '已删除',
    health_checked: '已检测',
    tool_called: '已调用',
    third_party_discovered: '已发现第三方参考',
    quarantined: '已隔离导入',
    security_scanned: '已安全扫描',
    pattern_learned: '已提炼模式',
    rewrite_planned: '已生成二开计划',
    install_precheck_staged: '已进入安装前预检',
    install_prechecked: '已完成安装前预检',
    version_snapshot_created: '已创建版本快照',
    install_applied: '已完成安装写入',
    install_rolled_back: '已回滚安装写入',
  };
  return `${noun} ${labels[event.action] || event.action}`;
}

function isThirdPartyResearchEvent(event: MemoryV2CapabilityEvent, metadata?: Record<string, unknown>): boolean {
  if (THIRD_PARTY_RESEARCH_ACTIONS.has(event.action as MemoryV2CapabilityResearchAction)) return true;
  return metadata?.researchMode === 'third_party_isolated' || metadata?.installState === 'not_installed';
}

function isRiskyResearchEvent(event: MemoryV2CapabilityEvent, metadata: Record<string, unknown>): boolean {
  if (event.status === 'failed') return true;
  return metadata.scanVerdict === 'blocked'
    || metadata.scanVerdict === 'review_required'
    || metadata.riskLevel === 'high';
}

function shouldProposeImprovement(event: MemoryV2CapabilityEvent, metadata: Record<string, unknown>): boolean {
  if (isRiskyResearchEvent(event, metadata)) return true;
  return event.action === 'rewrite_planned';
}

function shouldCreateCapabilityMemory(event: MemoryV2CapabilityEvent): boolean {
  if (eventAlreadyCaptured(event.id)) return false;
  const metadata = parseMetadata(event.metadata);
  if (event.status === 'failed' || isRiskyResearchEvent(event, metadata)) return true;
  if (isThirdPartyResearchEvent(event, metadata)) return true;
  return ['created', 'updated', 'enabled'].includes(event.action);
}

function researchMemoryTitle(event: MemoryV2CapabilityEvent, noun: string, metadata: Record<string, unknown>): string {
  const needsReview = shouldProposeImprovement(event, metadata);
  if (event.action === 'security_scanned') {
    return needsReview
      ? `第三方能力扫描：${noun} ${event.capability_name} 需要审核或二开`
      : `第三方能力扫描：${noun} ${event.capability_name} 可作为参考`;
  }
  if (event.action === 'pattern_learned') {
    return `第三方能力学习：${noun} ${event.capability_name}`;
  }
  if (event.action === 'rewrite_planned') {
    return `能力二开计划：${noun} ${event.capability_name}`;
  }
  if (event.action === 'quarantined') {
    return `第三方能力隔离导入：${noun} ${event.capability_name}`;
  }
  return `第三方能力参考：${noun} ${event.capability_name}`;
}

function researchMemoryBody(event: MemoryV2CapabilityEvent, noun: string, metadata: Record<string, unknown>): string {
  const patterns = Array.isArray(metadata.patterns)
    ? metadata.patterns.map((item) => normalizeText(item, 120)).filter(Boolean).slice(0, 8)
    : [];
  const lines = [
    `${noun}「${event.capability_name}」进入第三方能力隔离研究流程；当前只用于学习和复盘，未安装、未启用、不会自动执行。`,
    shouldProposeImprovement(event, metadata)
      ? '处理建议：不要直接安装原版，应先生成 Lumos 自己的 Skill/MCP 二开版本，并经过安全扫描、自检和用户确认。'
      : '处理建议：可作为能力设计参考；如要落地，仍需走 Lumos 二开生成和确认安装流程。',
    metadata.scanVerdict ? `扫描结论：${metadata.scanVerdict}` : '',
    metadata.riskLevel ? `风险级别：${metadata.riskLevel}` : '',
    metadata.candidateUrl ? `来源：${metadata.candidateUrl}` : '',
    metadata.quarantinePath ? `隔离位置：${metadata.quarantinePath}` : '',
    patterns.length > 0 ? `可学习模式：${patterns.join('；')}` : '',
    metadata.rewriteTarget ? `二开目标：${metadata.rewriteTarget}` : '',
    event.summary ? `摘要：${event.summary}` : '',
    event.detail ? `详情：${event.detail}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function createMemoryForEvent(event: MemoryV2CapabilityEvent): MemoryV2Entry | null {
  if (!shouldCreateCapabilityMemory(event)) return null;
  const noun = event.capability_type === 'mcp' ? 'MCP' : 'Skill';
  const isFailure = event.status === 'failed';
  const metadata = parseMetadata(event.metadata);
  const isResearch = isThirdPartyResearchEvent(event, metadata);
  const shouldImprove = shouldProposeImprovement(event, metadata);
  const failureLabel = event.action === 'health_checked'
    ? '健康检查失败'
    : event.action === 'tool_called'
      ? '工具调用失败'
      : '操作失败';
  const title = isResearch
    ? researchMemoryTitle(event, noun, metadata)
    : isFailure
    ? `能力缺口：${noun} ${event.capability_name} ${failureLabel}`
    : `能力事件：${actionLabel(event)} ${event.capability_name}`;
  const body = isResearch
    ? researchMemoryBody(event, noun, metadata)
    : isFailure
    ? [
        `${noun}「${event.capability_name}」${failureLabel}，后续睡眠应把它作为能力体验问题继续分析。`,
        event.summary ? `摘要：${event.summary}` : '',
        event.detail ? `详情：${event.detail}` : '',
      ].filter(Boolean).join('\n')
    : [
        `${noun}「${event.capability_name}」${actionLabel(event)}。`,
        event.summary ? `摘要：${event.summary}` : '',
      ].filter(Boolean).join('\n');

  return createMemoryV2Entry({
    kind: 'capability',
    scopeType: 'main_agent',
    scopeKey: 'main',
    ownerModule: 'memory-v2-capability-events',
    status: 'active',
    title,
    body,
    summary: normalizeText(body, 260),
    tags: [
      'capability',
      event.capability_type,
      event.action,
      isResearch ? 'third-party-research' : '',
      shouldImprove || isFailure ? 'gap' : 'available',
      shouldImprove || isFailure ? 'self-improvement' : 'capability-event',
      metadata.scanVerdict ? `scan-${metadata.scanVerdict}` : '',
    ].filter(Boolean),
    sourceType: SOURCE_TYPE,
    sourceId: event.id,
    relatedEntityType: event.capability_type,
    relatedEntityId: event.related_id || event.capability_name,
    confidence: shouldImprove || isFailure ? 0.9 : 0.75,
    importance: shouldImprove || isFailure ? 4 : 3,
    evidence: [
      `事件时间：${event.occurred_at}`,
      `来源：${event.source}`,
      `状态：${event.status}`,
      metadata.toolsCount !== undefined ? `工具数量：${metadata.toolsCount}` : '',
      metadata.scanVerdict ? `扫描结论：${metadata.scanVerdict}` : '',
      metadata.riskLevel ? `风险级别：${metadata.riskLevel}` : '',
    ].filter(Boolean).join('\n'),
    metadata: {
      capabilityEventId: event.id,
      capabilityType: event.capability_type,
      capabilityName: event.capability_name,
      action: event.action,
      status: event.status,
      source: event.source,
      version: event.version,
      eventMetadata: metadata,
    },
  });
}

export function summarizeNewMemoryV2CapabilityEvents(params: {
  limit?: number;
} = {}): MemoryV2CapabilityEventSummaryResult {
  const lastRowId = getLastRowId();
  const firstScanCutoff = new Date(Date.now() - FIRST_SCAN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .split('.')[0];
  const events = listMemoryV2CapabilityEvents({
    afterRowId: lastRowId,
    since: lastRowId > 0 ? undefined : firstScanCutoff,
    limit: params.limit ?? 300,
  });
  let maxRowId = lastRowId;
  const created: MemoryV2Entry[] = [];

  for (const event of events) {
    if (event._rowid) maxRowId = Math.max(maxRowId, event._rowid);
    const memory = createMemoryForEvent(event);
    if (memory) created.push(memory);
  }

  if (maxRowId > lastRowId) {
    setSetting(LAST_ROWID_KEY, String(maxRowId));
  }

  return {
    scanned: events.length,
    created,
    maxRowId,
  };
}
