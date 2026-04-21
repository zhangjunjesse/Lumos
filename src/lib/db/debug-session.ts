/**
 * Persistence layer for workflow debug sessions.
 *
 * One workflow has at most one debug session; each executed step is cached
 * (keyed by session_id + step_id) so users can iteratively tweak a long
 * workflow without re-running upstream nodes.
 *
 * Large step outputs (> {@link MAX_INLINE_OUTPUT_BYTES}) are spilled to
 * `~/.lumos/debug/<sessionId>/<stepId>.json` and the DB row stores the
 * relative path in `output_blob_path`. Reads are transparent.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb, dataDir } from './connection';
import type {
  DebugSession,
  DebugStepCacheMeta,
  DebugStepOutput,
} from '@/lib/workflow/debug-types';
import type { JsonValue } from '@/lib/workflow/types';

// ── Constants ───────────────────────────────────────────────────────────────

/** Inline outputs up to 64 KB; spill larger payloads to disk. */
export const MAX_INLINE_OUTPUT_BYTES = 64 * 1024;

const DEBUG_ROOT = path.join(dataDir, 'debug');

// ── Row types ───────────────────────────────────────────────────────────────

interface DebugSessionRow {
  id: string;
  workflow_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface DebugStepOutputRow {
  session_id: string;
  step_id: string;
  output_json: string;
  metadata_json: string;
  status: string;
  error: string;
  duration_ms: number;
  config_hash: string;
  output_blob_path: string | null;
  completed_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function rowToSession(row: DebugSessionRow): DebugSession {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as DebugSession['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readBlob(sessionId: string, relPath: string): unknown {
  const abs = path.join(DEBUG_ROOT, sessionId, path.basename(relPath));
  const text = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(text);
}

function rowToStepOutput(row: DebugStepOutputRow): DebugStepOutput {
  const output = row.output_blob_path
    ? readBlob(row.session_id, row.output_blob_path)
    : (row.output_json ? JSON.parse(row.output_json) : null);
  const metadata = row.metadata_json
    ? JSON.parse(row.metadata_json) as Record<string, JsonValue>
    : {};
  return {
    sessionId: row.session_id,
    stepId: row.step_id,
    output,
    metadata,
    status: row.status as DebugStepOutput['status'],
    error: row.error || undefined,
    durationMs: row.duration_ms,
    completedAt: row.completed_at,
    configHash: row.config_hash,
    outputBlobPath: row.output_blob_path,
  };
}

function rowToCacheMeta(
  row: DebugStepOutputRow,
): DebugStepCacheMeta {
  return {
    stepId: row.step_id,
    status: row.status as DebugStepOutput['status'],
    stale: false, // caller fills in by comparing configHash against current DSL
    durationMs: row.duration_ms,
    completedAt: row.completed_at,
  };
}

function ensureDebugDir(sessionId: string): string {
  const dir = path.join(DEBUG_ROOT, sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function deleteBlobIfAny(sessionId: string, relPath: string | null | undefined): void {
  if (!relPath) return;
  const abs = path.join(DEBUG_ROOT, sessionId, path.basename(relPath));
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

// ── Session CRUD ────────────────────────────────────────────────────────────

export function getDebugSessionByWorkflow(workflowId: string): DebugSession | null {
  const row = getDb()
    .prepare('SELECT * FROM workflow_debug_sessions WHERE workflow_id = ?')
    .get(workflowId) as DebugSessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function getOrCreateDebugSession(workflowId: string): DebugSession {
  const existing = getDebugSessionByWorkflow(workflowId);
  if (existing) return existing;

  const id = crypto.randomUUID();
  getDb().prepare(
    'INSERT INTO workflow_debug_sessions (id, workflow_id) VALUES (?, ?)',
  ).run(id, workflowId);

  const created = getDebugSessionByWorkflow(workflowId);
  if (!created) throw new Error('Failed to create debug session');
  return created;
}

export function setDebugSessionStatus(
  sessionId: string,
  status: DebugSession['status'],
): void {
  getDb().prepare(
    "UPDATE workflow_debug_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(status, sessionId);
}

// ── Cached step CRUD ────────────────────────────────────────────────────────

export function loadCachedSteps(sessionId: string): DebugStepOutput[] {
  const rows = getDb()
    .prepare('SELECT * FROM workflow_debug_step_outputs WHERE session_id = ?')
    .all(sessionId) as DebugStepOutputRow[];
  return rows.map(rowToStepOutput);
}

export function loadCachedStep(
  sessionId: string,
  stepId: string,
): DebugStepOutput | null {
  const row = getDb()
    .prepare('SELECT * FROM workflow_debug_step_outputs WHERE session_id = ? AND step_id = ?')
    .get(sessionId, stepId) as DebugStepOutputRow | undefined;
  return row ? rowToStepOutput(row) : null;
}

/**
 * 找到 run 时间窗内所有 status='error' 的 step output,用于失败定位。
 * `endIso` 为 null 时用当前时间作为上界(run 还没 updateRunHistory 时的竞态兜底)。
 */
export function loadFailedStepsInWindow(
  sessionId: string,
  startIso: string,
  endIso: string | null,
): DebugStepOutput[] {
  const upper = endIso ?? new Date(Date.now() + 60_000).toISOString();
  const rows = getDb()
    .prepare(`
      SELECT * FROM workflow_debug_step_outputs
      WHERE session_id = ? AND status = 'error'
        AND completed_at >= ? AND completed_at <= ?
      ORDER BY completed_at ASC
    `)
    .all(sessionId, startIso, upper) as DebugStepOutputRow[];
  return rows.map(rowToStepOutput);
}

export function loadStepCacheMetas(sessionId: string): DebugStepCacheMeta[] {
  const rows = getDb()
    .prepare(`
      SELECT session_id, step_id, status, duration_ms, config_hash, completed_at,
             output_json, metadata_json, error, output_blob_path
      FROM workflow_debug_step_outputs
      WHERE session_id = ?
    `)
    .all(sessionId) as DebugStepOutputRow[];
  return rows.map(rowToCacheMeta);
}

/** Upsert a cached step output; spills > {@link MAX_INLINE_OUTPUT_BYTES} to disk. */
export function upsertCachedStep(
  sessionId: string,
  output: DebugStepOutput,
): void {
  const outputJson = output.output === undefined ? '' : JSON.stringify(output.output);
  const metadataJson = JSON.stringify(output.metadata ?? {});

  let storedJson = outputJson;
  let blobPath: string | null = null;
  if (Buffer.byteLength(outputJson, 'utf-8') > MAX_INLINE_OUTPUT_BYTES) {
    const dir = ensureDebugDir(sessionId);
    const fileName = `${sanitize(output.stepId)}.json`;
    fs.writeFileSync(path.join(dir, fileName), outputJson, 'utf-8');
    blobPath = fileName;
    storedJson = '';
  }

  // Clean up prior blob file if the caller is replacing blob→inline (or both
  // inline→inline with no blob to clean). blob→blob overwrites the same path.
  const prior = getDb().prepare(
    'SELECT output_blob_path FROM workflow_debug_step_outputs WHERE session_id = ? AND step_id = ?',
  ).get(sessionId, output.stepId) as { output_blob_path: string | null } | undefined;
  if (prior?.output_blob_path && prior.output_blob_path !== blobPath) {
    deleteBlobIfAny(sessionId, prior.output_blob_path);
  }

  getDb().prepare(`
    INSERT INTO workflow_debug_step_outputs (
      session_id, step_id, output_json, metadata_json, status, error,
      duration_ms, config_hash, output_blob_path, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (session_id, step_id) DO UPDATE SET
      output_json = excluded.output_json,
      metadata_json = excluded.metadata_json,
      status = excluded.status,
      error = excluded.error,
      duration_ms = excluded.duration_ms,
      config_hash = excluded.config_hash,
      output_blob_path = excluded.output_blob_path,
      completed_at = excluded.completed_at
  `).run(
    sessionId,
    output.stepId,
    storedJson,
    metadataJson,
    output.status,
    output.error ?? '',
    output.durationMs,
    output.configHash,
    blobPath,
    output.completedAt,
  );
}

export function deleteCachedStep(sessionId: string, stepId: string): void {
  const db = getDb();
  const row = db.prepare(
    'SELECT output_blob_path FROM workflow_debug_step_outputs WHERE session_id = ? AND step_id = ?',
  ).get(sessionId, stepId) as { output_blob_path: string | null } | undefined;
  if (!row) return;
  deleteBlobIfAny(sessionId, row.output_blob_path);
  db.prepare(
    'DELETE FROM workflow_debug_step_outputs WHERE session_id = ? AND step_id = ?',
  ).run(sessionId, stepId);
}

export function deleteCachedStepsAndDownstream(
  sessionId: string,
  stepIds: string[],
): void {
  if (stepIds.length === 0) return;
  const db = getDb();
  const txn = db.transaction((ids: string[]) => {
    for (const id of ids) deleteCachedStep(sessionId, id);
  });
  txn(stepIds);
}

export function clearDebugSession(sessionId: string): void {
  getDb().prepare(
    'DELETE FROM workflow_debug_step_outputs WHERE session_id = ?',
  ).run(sessionId);
  const dir = path.join(DEBUG_ROOT, sessionId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ── Internals ───────────────────────────────────────────────────────────────

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}
