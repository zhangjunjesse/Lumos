import crypto from 'crypto';
import { getDb } from '@/lib/db/connection';
import { createMemoryV2Entry, listMemoryV2Entries, parseMemoryV2Tags } from './store';
import type { MemoryV2Entry } from './types';

export type MemoryV2ImprovementType = 'skill' | 'mcp' | 'workflow' | 'prompt' | 'rule';
export type MemoryV2ImprovementStatus = 'candidate' | 'approved' | 'building' | 'built' | 'rejected' | 'failed';
export type MemoryV2ImprovementRisk = 'low' | 'medium' | 'high';

export interface MemoryV2ImprovementCandidate {
  id: string;
  candidate_type: MemoryV2ImprovementType;
  status: MemoryV2ImprovementStatus;
  title: string;
  problem: string;
  evidence: string;
  proposed_capability: string;
  source_memory_ids: string;
  risk_level: MemoryV2ImprovementRisk;
  builder_session_id: string;
  fingerprint: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryV2ImprovementInput {
  candidateType: MemoryV2ImprovementType;
  status?: MemoryV2ImprovementStatus;
  title: string;
  problem: string;
  evidence?: string;
  proposedCapability: string;
  sourceMemoryIds?: string[];
  riskLevel?: MemoryV2ImprovementRisk;
  builderSessionId?: string;
  fingerprint?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryV2ImprovementUpdate {
  candidateType?: MemoryV2ImprovementType;
  status?: MemoryV2ImprovementStatus;
  title?: string;
  problem?: string;
  evidence?: string;
  proposedCapability?: string;
  sourceMemoryIds?: string[];
  riskLevel?: MemoryV2ImprovementRisk;
  builderSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryV2ImprovementListFilters {
  status?: MemoryV2ImprovementStatus | 'all';
  candidateType?: MemoryV2ImprovementType | 'all';
  query?: string;
  limit?: number;
}

export interface MemoryV2ImprovementGenerationResult {
  scanned: number;
  created: MemoryV2ImprovementCandidate[];
  candidates: MemoryV2ImprovementCandidate[];
}

const TYPE_SET = new Set<MemoryV2ImprovementType>(['skill', 'mcp', 'workflow', 'prompt', 'rule']);
const STATUS_SET = new Set<MemoryV2ImprovementStatus>(['candidate', 'approved', 'building', 'built', 'rejected', 'failed']);
const RISK_SET = new Set<MemoryV2ImprovementRisk>(['low', 'medium', 'high']);

const GAP_PATTERNS = [
  /能力缺口|补齐能力|自我改进|自我提升|需要.*(工具|能力|插件|skill|mcp)/i,
  /缺少|没有.*(工具|能力|插件|skill|mcp)|无法.*(调用|获取|处理|检索|查询|导出|同步|自动化)/i,
  /反复|经常|每次.*手动|重复.*(整理|检查|生成|导出|同步)/i,
  /失败原因|报错|做不到|不能.*(完成|执行|调用)|capability gap|improvement/i,
];

const EXISTING_CAPABILITY_PATTERNS = [
  /已安装|已经安装|已具备|已经具备|可用|已经可用|能力已补齐|built|installed|available/i,
];

const MCP_PATTERNS = [
  /mcp|api|http|接口|数据库|sqlite|postgres|mysql|sql|文件|目录|浏览器|网页|爬取|抓取|导出|同步/i,
  /登录态|cookie|token|服务器|ssh|命令|脚本|运行|自动化|下载|上传|消息|邮件|微信|飞书|闲鱼|x平台/i,
];

const SKILL_PATTERNS = [
  /skill|提示词|prompt|写作|总结|复盘|审查|规范|模板|判断标准|输出格式|沟通|风格|checklist|review/i,
];

const HIGH_RISK_PATTERNS = [
  /密码|口令|token|api[_\s-]?key|密钥|cookie|凭证|登录态|ssh|服务器|生产|支付|删除|写入|权限/i,
];

const SECRET_VALUE_PATTERNS = [
  /(password|passwd|pwd|token|api[_\s-]?key|secret|cookie|密码|口令|密钥|令牌)\s*[:：=]\s*([^\s，,；;]+)/ig,
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b([A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})\b/g,
];

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function normalizeText(value: unknown, max = 4000): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function normalizeMultiline(value: unknown, max = 8000): string {
  const text = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
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

function assertType(value: string): MemoryV2ImprovementType {
  if (TYPE_SET.has(value as MemoryV2ImprovementType)) return value as MemoryV2ImprovementType;
  throw new Error(`invalid improvement type: ${value}`);
}

function assertStatus(value: string): MemoryV2ImprovementStatus {
  if (STATUS_SET.has(value as MemoryV2ImprovementStatus)) return value as MemoryV2ImprovementStatus;
  throw new Error(`invalid improvement status: ${value}`);
}

function assertRisk(value: string): MemoryV2ImprovementRisk {
  if (RISK_SET.has(value as MemoryV2ImprovementRisk)) return value as MemoryV2ImprovementRisk;
  throw new Error(`invalid improvement risk: ${value}`);
}

function normalizeIds(ids?: string[]): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.map((id) => normalizeText(id, 80)).filter(Boolean))).slice(0, 24);
}

export function parseImprovementSourceMemoryIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeIds(parsed.map((item) => String(item)));
  } catch {
    return [];
  }
}

export function parseImprovementMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, (match, label) => {
      const prefix = typeof label === 'string' && /password|passwd|pwd|token|api|secret|cookie|密码|口令|密钥|令牌/i.test(label)
        ? String(label)
        : 'secret';
      return `${prefix}: [已隐藏，需保存到 Vault 后引用]`;
    });
  }
  return redacted;
}

function fingerprintFor(input: {
  candidateType: MemoryV2ImprovementType;
  title: string;
  problem: string;
  sourceMemoryIds?: string[];
}): string {
  const source = normalizeIds(input.sourceMemoryIds).join(',');
  const text = `${input.candidateType}:${source}:${normalizeText(input.title, 160)}:${normalizeText(input.problem, 420)}`;
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

export function listMemoryV2ImprovementCandidates(
  filters: MemoryV2ImprovementListFilters = {},
): MemoryV2ImprovementCandidate[] {
  const clauses: string[] = [];
  const args: unknown[] = [];

  if (filters.status && filters.status !== 'all') {
    clauses.push('status = ?');
    args.push(assertStatus(filters.status));
  }

  if (filters.candidateType && filters.candidateType !== 'all') {
    clauses.push('candidate_type = ?');
    args.push(assertType(filters.candidateType));
  }

  if (filters.query?.trim()) {
    const q = `%${filters.query.trim()}%`;
    clauses.push('(title LIKE ? OR problem LIKE ? OR evidence LIKE ? OR proposed_capability LIKE ?)');
    args.push(q, q, q, q);
  }

  const limit = Math.max(1, Math.min(filters.limit ?? 80, 500));
  args.push(limit);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb().prepare(
    `SELECT * FROM memory_v2_improvement_candidates
     ${where}
     ORDER BY
       CASE status
         WHEN 'candidate' THEN 0
         WHEN 'approved' THEN 1
         WHEN 'building' THEN 2
         WHEN 'failed' THEN 3
         WHEN 'built' THEN 4
         ELSE 5
       END,
       CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
       updated_at DESC
     LIMIT ?`,
  ).all(...args) as MemoryV2ImprovementCandidate[];
}

export function getMemoryV2ImprovementCandidate(id: string): MemoryV2ImprovementCandidate | undefined {
  return getDb().prepare('SELECT * FROM memory_v2_improvement_candidates WHERE id = ?').get(id) as MemoryV2ImprovementCandidate | undefined;
}

function getImprovementByFingerprint(fingerprint: string): MemoryV2ImprovementCandidate | undefined {
  if (!fingerprint) return undefined;
  return getDb()
    .prepare('SELECT * FROM memory_v2_improvement_candidates WHERE fingerprint = ? LIMIT 1')
    .get(fingerprint) as MemoryV2ImprovementCandidate | undefined;
}

export function createMemoryV2ImprovementCandidate(input: MemoryV2ImprovementInput): MemoryV2ImprovementCandidate {
  const candidateType = assertType(input.candidateType);
  const status = assertStatus(input.status || 'candidate');
  const riskLevel = assertRisk(input.riskLevel || (candidateType === 'mcp' ? 'medium' : 'low'));
  const title = normalizeText(input.title, 180);
  const problem = normalizeMultiline(input.problem, 3000);
  const proposedCapability = normalizeMultiline(input.proposedCapability, 3000);
  if (!title) throw new Error('improvement title is required');
  if (!problem) throw new Error('improvement problem is required');
  if (!proposedCapability) throw new Error('proposed capability is required');

  const sourceMemoryIds = normalizeIds(input.sourceMemoryIds);
  const fingerprint = normalizeText(input.fingerprint || fingerprintFor({
    candidateType,
    title,
    problem,
    sourceMemoryIds,
  }), 80);
  const existing = getImprovementByFingerprint(fingerprint);
  if (existing) return existing;

  const id = crypto.randomBytes(16).toString('hex');
  const now = nowSql();
  getDb().prepare(
    `INSERT INTO memory_v2_improvement_candidates
      (id, candidate_type, status, title, problem, evidence, proposed_capability,
       source_memory_ids, risk_level, builder_session_id, fingerprint, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    candidateType,
    status,
    title,
    problem,
    normalizeMultiline(input.evidence, 2400),
    proposedCapability,
    JSON.stringify(sourceMemoryIds),
    riskLevel,
    normalizeText(input.builderSessionId, 80),
    fingerprint,
    normalizeJson(input.metadata),
    now,
    now,
  );

  return getMemoryV2ImprovementCandidate(id)!;
}

export function updateMemoryV2ImprovementCandidate(
  id: string,
  input: MemoryV2ImprovementUpdate,
): MemoryV2ImprovementCandidate | undefined {
  const existing = getMemoryV2ImprovementCandidate(id);
  if (!existing) return undefined;

  const candidateType = input.candidateType ? assertType(input.candidateType) : existing.candidate_type;
  const status = input.status ? assertStatus(input.status) : existing.status;
  const riskLevel = input.riskLevel ? assertRisk(input.riskLevel) : existing.risk_level;
  const title = input.title !== undefined ? normalizeText(input.title, 180) : existing.title;
  const problem = input.problem !== undefined ? normalizeMultiline(input.problem, 3000) : existing.problem;
  const proposedCapability = input.proposedCapability !== undefined
    ? normalizeMultiline(input.proposedCapability, 3000)
    : existing.proposed_capability;
  if (!title || !problem || !proposedCapability) {
    throw new Error('improvement title, problem and proposed capability are required');
  }

  getDb().prepare(
    `UPDATE memory_v2_improvement_candidates
     SET candidate_type = ?,
         status = ?,
         title = ?,
         problem = ?,
         evidence = ?,
         proposed_capability = ?,
         source_memory_ids = ?,
         risk_level = ?,
         builder_session_id = ?,
         metadata = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    candidateType,
    status,
    title,
    problem,
    input.evidence !== undefined ? normalizeMultiline(input.evidence, 2400) : existing.evidence,
    proposedCapability,
    input.sourceMemoryIds !== undefined ? JSON.stringify(normalizeIds(input.sourceMemoryIds)) : existing.source_memory_ids,
    riskLevel,
    input.builderSessionId !== undefined ? normalizeText(input.builderSessionId, 80) : existing.builder_session_id,
    input.metadata !== undefined ? normalizeJson(input.metadata) : existing.metadata,
    nowSql(),
    id,
  );

  const updated = getMemoryV2ImprovementCandidate(id);
  if (updated?.status === 'built' && existing.status !== 'built') {
    createBuiltCapabilityMemory(updated);
  }
  return updated;
}

function textForEntry(entry: MemoryV2Entry): string {
  return `${entry.title}\n${entry.summary}\n${entry.body}\n${entry.evidence}`.trim();
}

function hasGapSignal(entry: MemoryV2Entry): boolean {
  if (entry.status === 'archived' || entry.status === 'rejected') return false;
  const text = textForEntry(entry);
  if (!text || /记忆自省：未发现待处理问题/.test(text)) return false;
  const hasGap = GAP_PATTERNS.some((pattern) => pattern.test(text));
  if (entry.kind === 'capability') {
    const tags = parseMemoryV2Tags(entry.tags);
    const taggedAsGap = tags.some((tag) => ['gap', 'missing', 'todo', 'self-improvement'].includes(tag));
    const looksExisting = EXISTING_CAPABILITY_PATTERNS.some((pattern) => pattern.test(text));
    return !looksExisting && (hasGap || taggedAsGap);
  }
  if (entry.kind === 'reflection') return hasGap;
  if (entry.kind === 'task') return hasGap && /能力|工具|skill|mcp|插件|自动化/i.test(text);
  return false;
}

function inferImprovementType(entry: MemoryV2Entry): MemoryV2ImprovementType {
  const text = textForEntry(entry);
  const wantsMcp = MCP_PATTERNS.some((pattern) => pattern.test(text));
  const wantsSkill = SKILL_PATTERNS.some((pattern) => pattern.test(text));
  if (wantsMcp) return 'mcp';
  if (wantsSkill) return 'skill';
  if (/流程|规范|输出|沟通|复盘|判断|模板/i.test(text)) return 'skill';
  return entry.kind === 'capability' ? 'skill' : 'mcp';
}

function inferRisk(candidateType: MemoryV2ImprovementType, entry: MemoryV2Entry): MemoryV2ImprovementRisk {
  const text = textForEntry(entry);
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(text))) return 'high';
  if (candidateType === 'mcp') return 'medium';
  return 'low';
}

function buildProblem(entry: MemoryV2Entry): string {
  const lines = [
    `来源记忆：${entry.kind} / ${entry.scope_type}:${entry.scope_key || 'default'}`,
    `标题：${entry.title}`,
    entry.summary ? `摘要：${entry.summary}` : '',
    entry.body ? `内容：${entry.body}` : '',
  ].filter(Boolean);
  return redactSensitiveText(normalizeMultiline(lines.join('\n'), 1800));
}

function buildEvidence(entry: MemoryV2Entry): string {
  const tags = parseMemoryV2Tags(entry.tags);
  const lines = [
    entry.evidence ? `证据：${entry.evidence}` : '',
    `状态：${entry.status}`,
    `重要度：${entry.importance}/5`,
    tags.length > 0 ? `标签：${tags.join(', ')}` : '',
    `更新时间：${entry.updated_at}`,
  ].filter(Boolean);
  return redactSensitiveText(normalizeMultiline(lines.join('\n'), 1400));
}

function buildProposedCapability(candidateType: MemoryV2ImprovementType, entry: MemoryV2Entry): string {
  const target = normalizeText(entry.title.replace(/^能力记忆[:：]?/, ''), 120);
  if (candidateType === 'mcp') {
    return [
      `为 Lumos 生成一个 MCP，用来补齐“${target}”这类执行型能力缺口。`,
      'MCP 应暴露最小可用工具，包含输入参数校验、清晰错误返回、无凭证时的可操作提示，以及安装后的自测路径。',
      '如需凭证，只能使用环境变量、header 占位符或 Vault 引用，不允许把明文密钥写进脚本或配置。',
    ].join('\n');
  }
  if (candidateType === 'workflow') {
    return `把“${target}”沉淀成可重复执行的工作流候选，明确触发条件、输入资源、步骤、失败处理和验收标准。`;
  }
  if (candidateType === 'prompt' || candidateType === 'rule') {
    return `把“${target}”沉淀成主代理可复用的规则或提示词，明确判断标准、输出结构、边界条件和不该做的事。`;
  }
  return [
    `为 Lumos 生成一个 Skill，用来补齐“${target}”这类认知和协作型能力缺口。`,
    'Skill 应固化情报收集、参与方沟通、资源确认、判断标准、输出格式、风险边界和验收清单。',
  ].join('\n');
}

function titleForCandidate(candidateType: MemoryV2ImprovementType, entry: MemoryV2Entry): string {
  const label: Record<MemoryV2ImprovementType, string> = {
    skill: 'Skill 改进',
    mcp: 'MCP 改进',
    workflow: '工作流改进',
    prompt: '提示词改进',
    rule: '规则改进',
  };
  return normalizeText(`${label[candidateType]}：${entry.title}`, 120);
}

export function generateMemoryV2ImprovementCandidates(): MemoryV2ImprovementGenerationResult {
  const sourceEntries = listMemoryV2Entries({ status: 'all', includeArchived: true, limit: 1000 })
    .filter(hasGapSignal)
    .slice(0, 80);
  const created: MemoryV2ImprovementCandidate[] = [];

  for (const entry of sourceEntries) {
    const candidateType = inferImprovementType(entry);
    const problem = buildProblem(entry);
    const input: MemoryV2ImprovementInput = {
      candidateType,
      title: titleForCandidate(candidateType, entry),
      problem,
      evidence: buildEvidence(entry),
      proposedCapability: buildProposedCapability(candidateType, entry),
      sourceMemoryIds: [entry.id],
      riskLevel: inferRisk(candidateType, entry),
      fingerprint: fingerprintFor({
        candidateType,
        title: entry.title,
        problem,
        sourceMemoryIds: [entry.id],
      }),
      metadata: {
        generatedBy: 'memory-v2-self-improvement',
        sourceKind: entry.kind,
        sourceScopeType: entry.scope_type,
        sourceScopeKey: entry.scope_key,
        sourceUpdatedAt: entry.updated_at,
      },
    };
    const before = getImprovementByFingerprint(input.fingerprint || '');
    const candidate = createMemoryV2ImprovementCandidate(input);
    if (!before) created.push(candidate);
  }

  return {
    scanned: sourceEntries.length,
    created,
    candidates: listMemoryV2ImprovementCandidates({ limit: 100 }),
  };
}

export function buildCapabilityBuilderPromptForImprovement(candidate: MemoryV2ImprovementCandidate): string {
  const sourceIds = parseImprovementSourceMemoryIds(candidate.source_memory_ids);
  const typeHint = candidate.candidate_type === 'mcp'
    ? '优先生成 MCP。只有当它完全不需要外部系统、代码执行、文件/网络/数据库访问时，才改成 Skill。'
    : candidate.candidate_type === 'skill'
      ? '优先生成 Skill。只有当它必须执行代码、访问文件/网络/数据库/API 时，才改成 MCP。'
      : '请判断应生成 Skill 还是 MCP；如果当前生成器无法覆盖该类型，选择最接近的 Skill/MCP 形式。';

  return [
    '这是 Lumos 自我改进候选。用户已经选择把它交给能力生成器，请直接产出可安装的 `lumos-extension-plan` JSON，不要停在教程或手工步骤。',
    '',
    `候选 ID：${candidate.id}`,
    `候选类型：${candidate.candidate_type}`,
    `风险级别：${candidate.risk_level}`,
    sourceIds.length > 0 ? `来源记忆：${sourceIds.join(', ')}` : '',
    '',
    '## 问题',
    candidate.problem,
    '',
    '## 证据',
    candidate.evidence || '无补充证据。',
    '',
    '## 建议能力',
    candidate.proposed_capability,
    '',
    '## 生成要求',
    `- ${typeHint}`,
    '- 输出必须能被 Lumos 的 Apply 按钮直接安装。',
    '- 不要把任何密码、token、cookie、密钥、登录态、服务器凭证写死在 Skill、脚本、env、headers 或示例里。',
    '- 如果需要凭证，使用清晰的 env/header/Vault 占位符，并在描述里说明用户需要补什么资源。',
    '- MCP 必须遵守 Lumos Python MCP 模板、可移植路径和安装后自测要求。',
    '- Skill 必须写成可复用工作方法，覆盖情报、参与方、资源、能力边界和验收标准。',
  ].filter(Boolean).join('\n');
}

function createBuiltCapabilityMemory(candidate: MemoryV2ImprovementCandidate): void {
  const exists = listMemoryV2Entries({
    kind: 'capability',
    status: 'all',
    includeArchived: true,
    ownerModule: 'memory-v2-self-improvement',
    limit: 500,
  }).some((entry) => entry.source_id === candidate.id);
  if (exists) return;

  createMemoryV2Entry({
    kind: 'capability',
    scopeType: 'main_agent',
    scopeKey: 'main',
    ownerModule: 'memory-v2-self-improvement',
    status: 'active',
    title: `能力已改进：${candidate.title}`,
    body: [
      `已完成自我改进候选：${candidate.title}`,
      `类型：${candidate.candidate_type}`,
      candidate.builder_session_id ? `生成器会话：${candidate.builder_session_id}` : '',
      '',
      candidate.proposed_capability,
    ].filter(Boolean).join('\n'),
    summary: normalizeText(candidate.proposed_capability, 240),
    tags: ['capability', 'self-improvement', 'built', candidate.candidate_type],
    sourceType: 'memory_v2_improvement',
    sourceId: candidate.id,
    confidence: 0.8,
    importance: candidate.risk_level === 'high' ? 5 : 4,
    evidence: candidate.evidence,
    metadata: {
      improvementCandidateId: candidate.id,
      builderSessionId: candidate.builder_session_id,
      sourceMemoryIds: parseImprovementSourceMemoryIds(candidate.source_memory_ids),
    },
  });
}
