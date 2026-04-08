import { randomUUID } from 'crypto';
import { getDb } from './connection';

// ---------------------------------------------------------------------------
// Storage record (content_skeleton JSON shape)
// ---------------------------------------------------------------------------

interface WorkflowAgentPresetRecord {
  kind: 'workflow-agent-preset';
  version: 1;
  expertise: string;
  role?: 'worker' | 'researcher' | 'coder' | 'integration';
  systemPrompt?: string;
  model?: string;
  allowedTools?: ('workspace.read' | 'workspace.write' | 'shell.exec')[];
  outputMode?: 'structured' | 'plain-text';
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
  timeoutMs?: number;
  maxRetries?: number;
  isEnabled?: boolean;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WorkflowAgentPresetConfig {
  expertise: string;
  role?: 'worker' | 'researcher' | 'coder' | 'integration';
  systemPrompt?: string;
  model?: string;
  allowedTools?: ('workspace.read' | 'workspace.write' | 'shell.exec')[];
  outputMode?: 'structured' | 'plain-text';
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface WorkflowAgentPreset {
  id: string;
  name: string;
  description: string;
  category: 'builtin' | 'user';
  config: WorkflowAgentPresetConfig;
  isEnabled: boolean;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowAgentPresetInput {
  name: string;
  description?: string;
  expertise: string;
  role?: WorkflowAgentPresetConfig['role'];
  systemPrompt?: string;
  model?: string;
  allowedTools?: WorkflowAgentPresetConfig['allowedTools'];
  outputMode?: WorkflowAgentPresetConfig['outputMode'];
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export type UpdateWorkflowAgentPresetInput = Partial<CreateWorkflowAgentPresetInput>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TemplateRow {
  id: string;
  name: string;
  type: string;
  category: string;
  content_skeleton: string;
  description: string;
  created_at: string;
  updated_at: string;
}

function hasTemplatesTable(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='templates'")
    .get() as { name?: string } | undefined;
  return row?.name === 'templates';
}

export function parseWorkflowAgentPresetRecord(raw: unknown): WorkflowAgentPresetConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'workflow-agent-preset' || r.version !== 1) return null;
  if (typeof r.expertise !== 'string' || !r.expertise.trim()) return null;

  const config: WorkflowAgentPresetConfig = { expertise: r.expertise.trim() };
  if (typeof r.role === 'string') config.role = r.role as WorkflowAgentPresetConfig['role'];
  if (typeof r.systemPrompt === 'string') config.systemPrompt = r.systemPrompt;
  if (typeof r.model === 'string') config.model = r.model;
  if (Array.isArray(r.allowedTools)) config.allowedTools = r.allowedTools as WorkflowAgentPresetConfig['allowedTools'];
  if (typeof r.outputMode === 'string') config.outputMode = r.outputMode as WorkflowAgentPresetConfig['outputMode'];
  if (Array.isArray(r.capabilityTags)) config.capabilityTags = r.capabilityTags as string[];
  if (typeof r.memoryPolicy === 'string') config.memoryPolicy = r.memoryPolicy;
  if (typeof r.concurrencyLimit === 'number') config.concurrencyLimit = r.concurrencyLimit;
  if (typeof r.timeoutMs === 'number') config.timeoutMs = r.timeoutMs;
  if (typeof r.maxRetries === 'number') config.maxRetries = r.maxRetries;
  return config;
}

function rowToPreset(row: TemplateRow): WorkflowAgentPreset | null {
  let payload: unknown;
  try { payload = JSON.parse(row.content_skeleton); } catch { return null; }
  const config = parseWorkflowAgentPresetRecord(payload);
  if (!config) return null;
  const record = payload as WorkflowAgentPresetRecord;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category as 'builtin' | 'user',
    config,
    isEnabled: record.isEnabled !== false,
    ...(typeof record.sortOrder === 'number' ? { sortOrder: record.sortOrder } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildRecord(
  input: CreateWorkflowAgentPresetInput,
  extra?: Pick<WorkflowAgentPresetRecord, 'isEnabled' | 'sortOrder'>,
): WorkflowAgentPresetRecord {
  const record: WorkflowAgentPresetRecord = {
    kind: 'workflow-agent-preset',
    version: 1,
    expertise: input.expertise.trim(),
    ...extra,
  };
  if (input.role) record.role = input.role;
  if (input.systemPrompt) record.systemPrompt = input.systemPrompt;
  if (input.model) record.model = input.model;
  if (input.allowedTools?.length) record.allowedTools = input.allowedTools;
  if (input.outputMode) record.outputMode = input.outputMode;
  if (input.capabilityTags?.length) record.capabilityTags = input.capabilityTags;
  if (input.memoryPolicy) record.memoryPolicy = input.memoryPolicy;
  if (typeof input.concurrencyLimit === 'number') record.concurrencyLimit = input.concurrencyLimit;
  if (typeof input.timeoutMs === 'number') record.timeoutMs = input.timeoutMs;
  if (typeof input.maxRetries === 'number') record.maxRetries = input.maxRetries;
  return record;
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// Public CRUD
// ---------------------------------------------------------------------------

export function listWorkflowAgentPresets(): WorkflowAgentPreset[] {
  if (!hasTemplatesTable()) return [];
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM templates WHERE type='workflow-agent' ORDER BY updated_at DESC")
    .all() as TemplateRow[];
  return rows.flatMap((row) => { const p = rowToPreset(row); return p ? [p] : []; });
}

export function listPublishedWorkflowAgentPresets(): WorkflowAgentPreset[] {
  return listWorkflowAgentPresets().filter((p) => p.isEnabled !== false);
}

export function getWorkflowAgentPreset(id: string): WorkflowAgentPreset | undefined {
  if (!hasTemplatesTable()) return undefined;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM templates WHERE id=? AND type='workflow-agent'")
    .get(id) as TemplateRow | undefined;
  if (!row) return undefined;
  return rowToPreset(row) ?? undefined;
}

export function getWorkflowAgentPresetByName(name: string): WorkflowAgentPreset | undefined {
  if (!hasTemplatesTable()) return undefined;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM templates WHERE type='workflow-agent' AND name=? LIMIT 1")
    .get(name.trim()) as TemplateRow | undefined;
  if (!row) return undefined;
  return rowToPreset(row) ?? undefined;
}

export function createWorkflowAgentPreset(data: CreateWorkflowAgentPresetInput): WorkflowAgentPreset {
  if (!hasTemplatesTable()) throw new Error('Templates table not available');
  const db = getDb();
  const id = randomUUID();
  const ts = now();
  const skeleton = JSON.stringify(buildRecord(data));
  db.prepare(
    "INSERT INTO templates (id, name, type, category, content_skeleton, description, created_at, updated_at) VALUES (?, ?, 'workflow-agent', 'user', ?, ?, ?, ?)",
  ).run(id, data.name.trim(), skeleton, (data.description ?? '').trim(), ts, ts);
  const preset = getWorkflowAgentPreset(id);
  if (!preset) throw new Error('Failed to create workflow agent preset');
  return preset;
}

export function updateWorkflowAgentPreset(id: string, data: UpdateWorkflowAgentPresetInput): WorkflowAgentPreset {
  if (!hasTemplatesTable()) throw new Error('Templates table not available');
  const existing = getWorkflowAgentPreset(id);
  if (!existing) throw new Error(`Workflow agent preset '${id}' not found`);
  if (existing.category === 'builtin') throw new Error(`Cannot update builtin workflow agent preset '${id}'`);
  const ts = now();
  const merged: CreateWorkflowAgentPresetInput = {
    name: data.name ?? existing.name,
    description: data.description !== undefined ? data.description : existing.description,
    expertise: data.expertise ?? existing.config.expertise,
    role: data.role !== undefined ? data.role : existing.config.role,
    systemPrompt: data.systemPrompt !== undefined ? data.systemPrompt : existing.config.systemPrompt,
    model: data.model !== undefined ? data.model : existing.config.model,
    allowedTools: data.allowedTools !== undefined ? data.allowedTools : existing.config.allowedTools,
    outputMode: data.outputMode !== undefined ? data.outputMode : existing.config.outputMode,
    capabilityTags: data.capabilityTags !== undefined ? data.capabilityTags : existing.config.capabilityTags,
    memoryPolicy: data.memoryPolicy !== undefined ? data.memoryPolicy : existing.config.memoryPolicy,
    concurrencyLimit: data.concurrencyLimit !== undefined ? data.concurrencyLimit : existing.config.concurrencyLimit,
    timeoutMs: data.timeoutMs !== undefined ? data.timeoutMs : existing.config.timeoutMs,
    maxRetries: data.maxRetries !== undefined ? data.maxRetries : existing.config.maxRetries,
  };
  const skeleton = JSON.stringify(buildRecord(merged, { isEnabled: existing.isEnabled, sortOrder: existing.sortOrder }));
  const db = getDb();
  db.prepare(
    "UPDATE templates SET name=?, content_skeleton=?, description=?, updated_at=? WHERE id=? AND type='workflow-agent'",
  ).run(merged.name.trim(), skeleton, (merged.description ?? '').trim(), ts, id);
  const updated = getWorkflowAgentPreset(id);
  if (!updated) throw new Error(`Failed to update workflow agent preset '${id}'`);
  return updated;
}

export function deleteWorkflowAgentPreset(id: string): void {
  if (!hasTemplatesTable()) return;
  const existing = getWorkflowAgentPreset(id);
  if (!existing) return;
  if (existing.category === 'builtin') throw new Error(`Cannot delete builtin workflow agent preset '${id}'`);
  getDb().prepare("DELETE FROM templates WHERE id=? AND type='workflow-agent'").run(id);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const BUILTIN_PRESET_SEEDS: Array<{ id: string; name: string; description: string } & Omit<WorkflowAgentPresetRecord, 'kind' | 'version'>> = [
  {
    id: 'builtin-worker',
    name: '通用执行者',
    description: '执行通用工作流步骤，保证结果边界稳定，适合作为单步任务和默认工作执行者。',
    expertise: '执行通用工作流步骤，适合代码编写、文件操作、shell 命令',
    role: 'worker',
    systemPrompt: 'You are the workflow worker agent.\nExecute only the assigned workflow step and keep the result bounded to the provided prompt.\nUse the local workspace when needed, but do not invent upstream context or perform out-of-band coordination.\nReturn a structured stage result that downstream workflow steps can consume.',
    allowedTools: ['workspace.read', 'workspace.write', 'shell.exec'],
    capabilityTags: ['execution', 'workflow-step'],
    memoryPolicy: 'ephemeral-stage',
    concurrencyLimit: 1,
  },
  {
    id: 'builtin-researcher',
    name: '研究员',
    description: '负责分析、归纳和证据提炼，适合在执行层输出可交接摘要和事实性结论。',
    expertise: '只读分析和归纳，适合从已有上下文中提炼事实、生成摘要',
    role: 'researcher',
    systemPrompt: 'You are the workflow research agent.\nFocus on analysis, synthesis, and extracting grounded facts from the provided context and local workspace.\nDo not browse the web or trigger side effects; browser and notification actions belong to dedicated workflow step types.\nReturn a concise, evidence-oriented summary for downstream steps.',
    allowedTools: ['workspace.read'],
    capabilityTags: ['research', 'analysis', 'workflow-step'],
    memoryPolicy: 'ephemeral-stage',
    concurrencyLimit: 1,
  },
  {
    id: 'builtin-coder',
    name: '代码专家',
    description: '负责代码相关的实现、修改和代码级分析，但仍被约束在单个工作流步骤边界内。',
    expertise: '仓库内代码实现和代码级分析，适合编写、修改、审查代码',
    role: 'coder',
    systemPrompt: 'You are the workflow code agent.\nWork directly against the local repository when the prompt requires code changes or code-aware analysis.\nKeep edits scoped to the assigned step and surface any blocking ambiguity in the structured result.\nDo not take browser or notification side effects; those belong to dedicated workflow step types.',
    allowedTools: ['workspace.read', 'workspace.write', 'shell.exec'],
    capabilityTags: ['code', 'implementation', 'workflow-step'],
    memoryPolicy: 'ephemeral-stage',
    concurrencyLimit: 1,
  },
  {
    id: 'builtin-integration',
    name: '集成专员',
    description: '负责生成面向集成的结果、消息载荷和交付说明，但不直接触发浏览器或通知副作用。',
    expertise: '准备集成载荷和交付说明，适合 API 对接、消息组装、格式转换',
    role: 'integration',
    systemPrompt: 'You are the workflow integration agent.\nPrepare integration-ready outputs, message payloads, or coordination artifacts based on the provided context.\nDo not directly send notifications or operate the browser; dedicated workflow step types own those side effects in Workflow DSL v1.\nReturn structured outputs that another workflow step can execute or publish.',
    allowedTools: ['workspace.read', 'workspace.write'],
    capabilityTags: ['integration', 'coordination', 'workflow-step'],
    memoryPolicy: 'ephemeral-stage',
    concurrencyLimit: 1,
  },
];

export function seedBuiltinWorkflowAgentPresets(): void {
  if (!hasTemplatesTable()) return;
  const db = getDb();
  const ts = now();
  for (const seed of BUILTIN_PRESET_SEEDS) {
    const record: WorkflowAgentPresetRecord = {
      kind: 'workflow-agent-preset',
      version: 1,
      expertise: seed.expertise,
      role: seed.role,
      systemPrompt: seed.systemPrompt,
      allowedTools: seed.allowedTools,
      capabilityTags: seed.capabilityTags,
      memoryPolicy: seed.memoryPolicy,
      concurrencyLimit: seed.concurrencyLimit,
    };
    db.prepare(
      "INSERT OR IGNORE INTO templates (id, name, type, category, content_skeleton, description, created_at, updated_at) VALUES (?, ?, 'workflow-agent', 'builtin', ?, ?, ?, ?)",
    ).run(seed.id, seed.name, JSON.stringify(record), seed.description, ts, ts);
  }
}
