import { randomUUID } from 'crypto';
import { getDb } from './index';
import type { AnyWorkflowDSL } from '@/lib/workflow/types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  tags: string;
  group_name: string;
  dsl_version: string;
  workflow_dsl: string;
  is_template: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  tags: string[];
  groupName: string;
  dslVersion: string;
  workflowDsl: AnyWorkflowDSL;
  isTemplate: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  tags?: string[];
  groupName?: string;
  workflowDsl: AnyWorkflowDSL;
  isTemplate?: boolean;
  createdBy?: string;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  tags?: string[];
  groupName?: string;
  workflowDsl?: AnyWorkflowDSL;
  isTemplate?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function rowToRecord(row: WorkflowRow): WorkflowRecord {
  let dsl: AnyWorkflowDSL;
  try {
    dsl = JSON.parse(row.workflow_dsl) as AnyWorkflowDSL;
  } catch {
    dsl = { version: 'v2', name: row.name, steps: [] };
  }

  let tags: string[];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags,
    groupName: row.group_name || '',
    dslVersion: row.dsl_version,
    workflowDsl: dsl,
    isTemplate: row.is_template === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasTable(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflows'")
    .get() as { name?: string } | undefined;
  return row?.name === 'workflows';
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function listWorkflows(opts?: { isTemplate?: boolean }): WorkflowRecord[] {
  if (!hasTable()) return [];
  const db = getDb();

  if (opts?.isTemplate !== undefined) {
    const rows = db
      .prepare('SELECT * FROM workflows WHERE is_template = ? ORDER BY updated_at DESC')
      .all(opts.isTemplate ? 1 : 0) as WorkflowRow[];
    return rows.map(rowToRecord);
  }

  const rows = db
    .prepare('SELECT * FROM workflows ORDER BY updated_at DESC')
    .all() as WorkflowRow[];
  return rows.map(rowToRecord);
}

export function getWorkflow(id: string): WorkflowRecord | null {
  if (!hasTable()) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM workflows WHERE id = ?')
    .get(id) as WorkflowRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function createWorkflow(input: CreateWorkflowInput): WorkflowRecord {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const dslVersion = input.workflowDsl.version || 'v2';

  db.prepare(`
    INSERT INTO workflows
      (id, name, description, tags, group_name, dsl_version, workflow_dsl, is_template, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim(),
    (input.description || '').trim(),
    JSON.stringify(input.tags || []),
    input.groupName || '',
    dslVersion,
    JSON.stringify(input.workflowDsl),
    input.isTemplate ? 1 : 0,
    input.createdBy || 'user',
    now,
    now,
  );

  const record = getWorkflow(id);
  if (!record) throw new Error('Failed to create workflow');
  return record;
}

export function updateWorkflow(
  id: string,
  input: UpdateWorkflowInput,
): WorkflowRecord | null {
  const existing = getWorkflow(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const dsl = input.workflowDsl || existing.workflowDsl;

  db.prepare(`
    UPDATE workflows SET
      name = ?,
      description = ?,
      tags = ?,
      group_name = ?,
      dsl_version = ?,
      workflow_dsl = ?,
      is_template = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.description ?? existing.description,
    JSON.stringify(input.tags ?? existing.tags),
    input.groupName ?? existing.groupName,
    dsl.version || existing.dslVersion,
    JSON.stringify(dsl),
    (input.isTemplate ?? existing.isTemplate) ? 1 : 0,
    now,
    id,
  );

  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  if (!hasTable()) return false;
  const db = getDb();
  // Clear dangling FK references before deleting
  db.prepare('UPDATE scheduled_workflows SET workflow_id = NULL WHERE workflow_id = ?').run(id);
  const result = db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  return result.changes > 0;
}
