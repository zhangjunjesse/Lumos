import crypto from 'crypto';
import type { MediaJob, MediaJobStatus, MediaJobItem, MediaJobItemStatus, MediaContextEvent, BatchConfig } from '@/types';
import { getDb } from './connection';

// ==========================================
// Media Job Operations
// ==========================================

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  concurrency: 2,
  maxRetries: 2,
  retryDelayMs: 2000,
};

export function createMediaJob(params: {
  sessionId?: string;
  docPaths?: string[];
  stylePrompt?: string;
  batchConfig?: Partial<BatchConfig>;
  totalItems: number;
}): MediaJob {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const config = { ...DEFAULT_BATCH_CONFIG, ...params.batchConfig };

  db.prepare(
    `INSERT INTO media_jobs (id, session_id, status, doc_paths, style_prompt, batch_config, total_items, completed_items, failed_items, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(
    id,
    params.sessionId || null,
    'planned',
    JSON.stringify(params.docPaths || []),
    params.stylePrompt || '',
    JSON.stringify(config),
    params.totalItems,
    now,
    now,
  );

  return getMediaJob(id)!;
}

export function getMediaJob(id: string): MediaJob | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(id) as MediaJob | undefined;
}

export function getMediaJobsBySession(sessionId: string): MediaJob[] {
  const db = getDb();
  return db.prepare('SELECT * FROM media_jobs WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as MediaJob[];
}

export function getAllMediaJobs(limit = 50, offset = 0): MediaJob[] {
  const db = getDb();
  return db.prepare('SELECT * FROM media_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as MediaJob[];
}

export function updateMediaJobStatus(id: string, status: MediaJobStatus): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const completedAt = (status === 'completed' || status === 'cancelled' || status === 'failed') ? now : null;

  db.prepare(
    'UPDATE media_jobs SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?'
  ).run(status, now, completedAt, id);
}

export function updateMediaJobCounters(id: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`
    UPDATE media_jobs SET
      completed_items = (SELECT COUNT(*) FROM media_job_items WHERE job_id = ? AND status = 'completed'),
      failed_items = (SELECT COUNT(*) FROM media_job_items WHERE job_id = ? AND status = 'failed'),
      updated_at = ?
    WHERE id = ?
  `).run(id, id, now, id);
}

export function deleteMediaJob(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM media_jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

// ==========================================
// Media Job Item Operations
// ==========================================

export function createMediaJobItems(jobId: string, items: Array<{
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  model?: string;
  tags?: string[];
  sourceRefs?: string[];
}>): MediaJobItem[] {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const insertStmt = db.prepare(
    `INSERT INTO media_job_items (id, job_id, idx, prompt, aspect_ratio, image_size, model, tags, source_refs, status, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  );

  const ids: string[] = [];
  const transaction = db.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = crypto.randomBytes(16).toString('hex');
      ids.push(id);
      insertStmt.run(
        id, jobId, i,
        item.prompt,
        item.aspectRatio || '1:1',
        item.imageSize || '1K',
        item.model || '',
        JSON.stringify(item.tags || []),
        JSON.stringify(item.sourceRefs || []),
        now, now,
      );
    }
  });
  transaction();

  return ids.map(id => db.prepare('SELECT * FROM media_job_items WHERE id = ?').get(id) as MediaJobItem);
}

export function getMediaJobItems(jobId: string): MediaJobItem[] {
  const db = getDb();
  return db.prepare('SELECT * FROM media_job_items WHERE job_id = ? ORDER BY idx ASC').all(jobId) as MediaJobItem[];
}

export function getMediaJobItem(id: string): MediaJobItem | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM media_job_items WHERE id = ?').get(id) as MediaJobItem | undefined;
}

export function getPendingJobItems(jobId: string, maxRetries: number): MediaJobItem[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM media_job_items
     WHERE job_id = ? AND (status = 'pending' OR (status = 'failed' AND retry_count < ?))
     ORDER BY idx ASC`
  ).all(jobId, maxRetries) as MediaJobItem[];
}

export function updateMediaJobItem(id: string, updates: {
  status?: MediaJobItemStatus;
  retryCount?: number;
  resultMediaGenerationId?: string | null;
  error?: string | null;
  prompt?: string;
  aspectRatio?: string;
  imageSize?: string;
  tags?: string[];
}): MediaJobItem | undefined {
  const db = getDb();
  const existing = getMediaJobItem(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`
    UPDATE media_job_items SET
      status = ?,
      retry_count = ?,
      result_media_generation_id = ?,
      error = ?,
      prompt = ?,
      aspect_ratio = ?,
      image_size = ?,
      tags = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    updates.status ?? existing.status,
    updates.retryCount ?? existing.retry_count,
    updates.resultMediaGenerationId !== undefined ? updates.resultMediaGenerationId : existing.result_media_generation_id,
    updates.error !== undefined ? updates.error : existing.error,
    updates.prompt ?? existing.prompt,
    updates.aspectRatio ?? existing.aspect_ratio,
    updates.imageSize ?? existing.image_size,
    updates.tags ? JSON.stringify(updates.tags) : existing.tags,
    now,
    id,
  );

  return getMediaJobItem(id);
}

export function cancelPendingJobItems(jobId: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    "UPDATE media_job_items SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status IN ('pending', 'failed')"
  ).run(now, jobId);
}

// ==========================================
// Media Context Event Operations
// ==========================================

export function createContextEvent(params: {
  sessionId: string;
  jobId: string;
  payload: Record<string, unknown>;
  syncMode?: 'manual' | 'auto_batch';
}): MediaContextEvent {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    `INSERT INTO media_context_events (id, session_id, job_id, payload, sync_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, params.sessionId, params.jobId, JSON.stringify(params.payload), params.syncMode || 'manual', now);

  return db.prepare('SELECT * FROM media_context_events WHERE id = ?').get(id) as MediaContextEvent;
}

export function markContextEventSynced(id: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare('UPDATE media_context_events SET synced_at = ? WHERE id = ?').run(now, id);
}
