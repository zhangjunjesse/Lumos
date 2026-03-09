import { getDb } from '@/lib/db';
import { genId, now } from '@/lib/stores/helpers';

export type KbIngestJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type KbIngestItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'duplicate';
export type KbIngestJobSourceType = 'directory' | 'file';

export interface KbIngestJob {
  id: string;
  collection_id: string;
  source_dir: string;
  source_type: KbIngestJobSourceType;
  recursive: number;
  max_files: number;
  max_file_size: number;
  force_reprocess: number;
  status: KbIngestJobStatus;
  total_files: number;
  processed_files: number;
  success_files: number;
  failed_files: number;
  skipped_files: number;
  duplicate_files: number;
  error: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbIngestJobItem {
  id: string;
  job_id: string;
  idx: number;
  file_path: string;
  source_key: string;
  file_size: number;
  status: KbIngestItemStatus;
  attempts: number;
  item_id: string | null;
  mode: 'full' | 'reference';
  parse_error: string;
  error: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface CreateIngestJobParams {
  collectionId: string;
  sourceDir: string;
  sourceType?: KbIngestJobSourceType;
  recursive: boolean;
  maxFiles: number;
  maxFileSize: number;
  forceReprocess?: boolean;
  files: Array<{
    filePath: string;
    sourceKey: string;
    fileSize: number;
  }>;
}

export interface ClaimedIngestItem {
  jobId: string;
  itemId: string;
  collectionId: string;
  sourceDir: string;
  filePath: string;
  sourceKey: string;
  fileSize: number;
  maxFileSize: number;
  forceReprocess: boolean;
  attempt: number;
}

let ingestQueueSchemaChecked = false;

function ensureIngestQueueTables(): void {
  if (ingestQueueSchemaChecked) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_ingest_jobs (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES kb_collections(id),
      source_dir TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'directory'
        CHECK(source_type IN ('directory','file')),
      recursive INTEGER NOT NULL DEFAULT 1,
      max_files INTEGER NOT NULL DEFAULT 200,
      max_file_size INTEGER NOT NULL DEFAULT 20971520,
      force_reprocess INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','completed','failed','cancelled')),
      total_files INTEGER NOT NULL DEFAULT 0,
      processed_files INTEGER NOT NULL DEFAULT 0,
      success_files INTEGER NOT NULL DEFAULT 0,
      failed_files INTEGER NOT NULL DEFAULT 0,
      skipped_files INTEGER NOT NULL DEFAULT 0,
      duplicate_files INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      started_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kb_ingest_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES kb_ingest_jobs(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL DEFAULT 0,
      file_path TEXT NOT NULL,
      source_key TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','completed','failed','skipped','duplicate')),
      attempts INTEGER NOT NULL DEFAULT 0,
      item_id TEXT DEFAULT NULL REFERENCES kb_items(id) ON DELETE SET NULL,
      mode TEXT NOT NULL DEFAULT 'full'
        CHECK(mode IN ('full','reference')),
      parse_error TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_ingest_jobs_status ON kb_ingest_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_kb_ingest_jobs_collection ON kb_ingest_jobs(collection_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_kb_ingest_job_items_job ON kb_ingest_job_items(job_id, idx);
    CREATE INDEX IF NOT EXISTS idx_kb_ingest_job_items_status ON kb_ingest_job_items(status, updated_at);
  `);
  const jobCols = db.prepare("PRAGMA table_info(kb_ingest_jobs)").all() as { name: string }[];
  const jobColNames = jobCols.map((col) => col.name);
  if (!jobColNames.includes('force_reprocess')) {
    db.exec("ALTER TABLE kb_ingest_jobs ADD COLUMN force_reprocess INTEGER NOT NULL DEFAULT 0");
  }
  if (!jobColNames.includes('source_type')) {
    db.exec("ALTER TABLE kb_ingest_jobs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'directory'");
  }
  ingestQueueSchemaChecked = true;
}

function getJob(id: string): KbIngestJob | undefined {
  ensureIngestQueueTables();
  return getDb().prepare('SELECT * FROM kb_ingest_jobs WHERE id=?').get(id) as KbIngestJob | undefined;
}

export function getIngestJob(id: string): KbIngestJob | undefined {
  return getJob(id);
}

export function listIngestJobs(options?: {
  collectionId?: string;
  activeOnly?: boolean;
  limit?: number;
}): KbIngestJob[] {
  ensureIngestQueueTables();
  const db = getDb();
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const where: string[] = [];
  const values: unknown[] = [];

  if (options?.collectionId) {
    where.push('collection_id=?');
    values.push(options.collectionId);
  }
  if (options?.activeOnly) {
    where.push("status IN ('pending','running')");
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM kb_ingest_jobs ${whereSql} ORDER BY created_at DESC LIMIT ?`)
    .all(...values, limit) as KbIngestJob[];
}

export function listIngestJobItems(jobId: string, limit = 200): KbIngestJobItem[] {
  ensureIngestQueueTables();
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  return db
    .prepare('SELECT * FROM kb_ingest_job_items WHERE job_id=? ORDER BY idx ASC LIMIT ?')
    .all(jobId, safeLimit) as KbIngestJobItem[];
}

export function createIngestJob(params: CreateIngestJobParams): KbIngestJob {
  ensureIngestQueueTables();
  const db = getDb();
  const id = genId();
  const ts = now();

  const insertJob = db.prepare(`
    INSERT INTO kb_ingest_jobs
      (id, collection_id, source_dir, source_type, recursive, max_files, max_file_size, force_reprocess, status, total_files, processed_files, success_files, failed_files, skipped_files, duplicate_files, error, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, 0, 0, 0, 0, '', ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO kb_ingest_job_items
      (id, job_id, idx, file_path, source_key, file_size, status, attempts, item_id, mode, parse_error, error, created_at, updated_at, completed_at)
    VALUES
      (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, 'full', '', '', ?, ?, NULL)
  `);

  const transaction = db.transaction(() => {
    insertJob.run(
      id,
      params.collectionId,
      params.sourceDir,
      params.sourceType || 'directory',
      params.recursive ? 1 : 0,
      params.maxFiles,
      params.maxFileSize,
      params.forceReprocess ? 1 : 0,
      params.files.length,
      ts,
      ts,
    );
    params.files.forEach((file, index) => {
      insertItem.run(
        genId(),
        id,
        index,
        file.filePath,
        file.sourceKey,
        Math.max(0, Math.floor(file.fileSize || 0)),
        ts,
        ts,
      );
    });
  });

  transaction();
  return getJob(id)!;
}

export function resetRunningIngestQueue(): void {
  ensureIngestQueueTables();
  const db = getDb();
  const ts = now();
  db.prepare("UPDATE kb_ingest_job_items SET status='pending', updated_at=? WHERE status='running'").run(ts);
  db.prepare("UPDATE kb_ingest_jobs SET status='pending', updated_at=? WHERE status='running'").run(ts);
}

export function claimNextIngestItem(): ClaimedIngestItem | undefined {
  ensureIngestQueueTables();
  const db = getDb();
  const ts = now();

  const transaction = db.transaction((): ClaimedIngestItem | undefined => {
    const row = db.prepare(`
      SELECT
        j.id AS job_id,
        j.collection_id,
        j.source_dir,
        j.max_file_size,
        j.force_reprocess,
        j.status AS job_status,
        i.id AS item_id,
        i.file_path,
        i.source_key,
        i.file_size,
        i.attempts
      FROM kb_ingest_jobs j
      JOIN kb_ingest_job_items i ON i.job_id = j.id
      WHERE j.status IN ('pending','running')
        AND i.status = 'pending'
      ORDER BY j.created_at ASC, i.idx ASC
      LIMIT 1
    `).get() as {
      job_id: string;
      collection_id: string;
      source_dir: string;
      max_file_size: number;
      force_reprocess: number;
      job_status: KbIngestJobStatus;
      item_id: string;
      file_path: string;
      source_key: string;
      file_size: number;
      attempts: number;
    } | undefined;

    if (!row) return undefined;

    if (row.job_status === 'pending') {
      db.prepare(`
        UPDATE kb_ingest_jobs
        SET status='running',
            started_at=COALESCE(started_at, ?),
            updated_at=?
        WHERE id=?
      `).run(ts, ts, row.job_id);
    }

    const claimed = db.prepare(`
      UPDATE kb_ingest_job_items
      SET status='running',
          attempts=attempts + 1,
          updated_at=?
      WHERE id=? AND status='pending'
    `).run(ts, row.item_id);
    if (claimed.changes === 0) {
      return undefined;
    }

    return {
      jobId: row.job_id,
      itemId: row.item_id,
      collectionId: row.collection_id,
      sourceDir: row.source_dir,
      filePath: row.file_path,
      sourceKey: row.source_key,
      fileSize: Number.isFinite(row.file_size) ? Number(row.file_size) : 0,
      maxFileSize: Number.isFinite(row.max_file_size) ? Number(row.max_file_size) : 0,
      forceReprocess: Number(row.force_reprocess || 0) === 1,
      attempt: Number.isFinite(row.attempts) ? Number(row.attempts) + 1 : 1,
    };
  });

  return transaction();
}

function updateIngestItem(
  itemId: string,
  payload: {
    status: KbIngestItemStatus;
    itemId?: string | null;
    mode?: 'full' | 'reference';
    parseError?: string;
    error?: string;
  },
): void {
  ensureIngestQueueTables();
  const db = getDb();
  const ts = now();
  db.prepare(`
    UPDATE kb_ingest_job_items
    SET status=?,
        item_id=?,
        mode=?,
        parse_error=?,
        error=?,
        updated_at=?,
        completed_at=?
    WHERE id=?
  `).run(
    payload.status,
    payload.itemId ?? null,
    payload.mode ?? 'full',
    payload.parseError ?? '',
    payload.error ?? '',
    ts,
    ts,
    itemId,
  );
}

export function completeIngestItemSuccess(itemId: string, payload: {
  itemId?: string | null;
  mode?: 'full' | 'reference';
  parseError?: string;
}): void {
  updateIngestItem(itemId, {
    status: 'completed',
    itemId: payload.itemId ?? null,
    mode: payload.mode ?? 'full',
    parseError: payload.parseError ?? '',
    error: '',
  });
}

export function completeIngestItemDuplicate(itemId: string, existingItemId?: string): void {
  updateIngestItem(itemId, {
    status: 'duplicate',
    itemId: existingItemId ?? null,
    mode: 'full',
    parseError: '',
    error: '',
  });
}

export function completeIngestItemSkipped(itemId: string, reason: string): void {
  updateIngestItem(itemId, {
    status: 'skipped',
    itemId: null,
    mode: 'reference',
    parseError: reason,
    error: reason,
  });
}

export function completeIngestItemFailed(itemId: string, reason: string): void {
  updateIngestItem(itemId, {
    status: 'failed',
    itemId: null,
    mode: 'reference',
    parseError: reason,
    error: reason,
  });
}

export function refreshIngestJob(jobId: string): KbIngestJob | undefined {
  ensureIngestQueueTables();
  const db = getDb();
  const ts = now();

  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('completed','failed','skipped','duplicate') THEN 1 ELSE 0 END) AS processed,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status='duplicate' THEN 1 ELSE 0 END) AS duplicate,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running
    FROM kb_ingest_job_items
    WHERE job_id=?
  `).get(jobId) as {
    total: number | null;
    processed: number | null;
    success: number | null;
    failed: number | null;
    skipped: number | null;
    duplicate: number | null;
    pending: number | null;
    running: number | null;
  };

  const total = Number(counts.total || 0);
  const processed = Number(counts.processed || 0);
  const success = Number(counts.success || 0);
  const failed = Number(counts.failed || 0);
  const skipped = Number(counts.skipped || 0);
  const duplicate = Number(counts.duplicate || 0);
  const pending = Number(counts.pending || 0);
  const running = Number(counts.running || 0);

  const current = getJob(jobId);
  if (!current) return undefined;

  let nextStatus = current.status;
  let completedAt = current.completed_at;
  if (nextStatus !== 'cancelled') {
    if (pending === 0 && running === 0) {
      nextStatus = (success > 0 || duplicate > 0) ? 'completed' : 'failed';
      completedAt = ts;
    } else {
      nextStatus = running > 0 ? 'running' : 'pending';
      completedAt = null;
    }
  }

  db.prepare(`
    UPDATE kb_ingest_jobs
    SET status=?,
        total_files=?,
        processed_files=?,
        success_files=?,
        failed_files=?,
        skipped_files=?,
        duplicate_files=?,
        completed_at=?,
        updated_at=?
    WHERE id=?
  `).run(
    nextStatus,
    total,
    processed,
    success,
    failed,
    skipped,
    duplicate,
    completedAt,
    ts,
    jobId,
  );

  return getJob(jobId);
}

export function requeueFailedIngestItems(jobId: string): KbIngestJob | undefined {
  ensureIngestQueueTables();
  const db = getDb();
  const ts = now();
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE kb_ingest_job_items
      SET status='pending',
          item_id=NULL,
          parse_error='',
          error='',
          completed_at=NULL,
          updated_at=?
      WHERE job_id=?
        AND (
          status IN ('failed','skipped')
          OR (
            status='completed'
            AND mode='reference'
            AND parse_error <> ''
            AND (
              parse_error LIKE 'Cannot access file %'
              OR parse_error LIKE '%ENOENT%'
              OR parse_error LIKE '%EACCES%'
              OR parse_error LIKE '%EPERM%'
              OR parse_error LIKE '%EBUSY%'
              OR parse_error LIKE '%resource busy%'
              OR parse_error LIKE '%timeout%'
            )
          )
        )
    `).run(ts, jobId);
    db.prepare(`
      UPDATE kb_ingest_jobs
      SET status='pending',
          error='',
          completed_at=NULL,
          updated_at=?
      WHERE id=?
    `).run(ts, jobId);
  });
  transaction();
  return refreshIngestJob(jobId);
}

export function cancelIngestJob(jobId: string, reason = 'cancelled_by_user'): KbIngestJob | undefined {
  ensureIngestQueueTables();
  const db = getDb();
  const ts = now();
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE kb_ingest_job_items
      SET status='skipped',
          parse_error=?,
          error=?,
          completed_at=?,
          updated_at=?
      WHERE job_id=? AND status IN ('pending','running')
    `).run(reason, reason, ts, ts, jobId);
    db.prepare(`
      UPDATE kb_ingest_jobs
      SET status='cancelled',
          error=?,
          completed_at=?,
          updated_at=?
      WHERE id=?
    `).run(reason, ts, ts, jobId);
  });
  transaction();
  return refreshIngestJob(jobId) || getJob(jobId);
}

export function clearIngestJobs(): { cleared_jobs: number; cleared_items: number } {
  ensureIngestQueueTables();
  const db = getDb();
  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM kb_ingest_jobs) AS jobs,
      (SELECT COUNT(*) FROM kb_ingest_job_items) AS items
  `).get() as { jobs: number; items: number };

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM kb_ingest_job_items').run();
    db.prepare('DELETE FROM kb_ingest_jobs').run();
  });
  transaction();

  return {
    cleared_jobs: Number(summary.jobs || 0),
    cleared_items: Number(summary.items || 0),
  };
}

export function clearIngestJobsBySourceDir(
  collectionId: string,
  sourceDir: string,
): { cleared_jobs: number; cleared_items: number } {
  ensureIngestQueueTables();
  const db = getDb();
  const summary = db.prepare(`
    SELECT
      COUNT(DISTINCT j.id) AS jobs,
      COUNT(i.id) AS items
    FROM kb_ingest_jobs j
    LEFT JOIN kb_ingest_job_items i ON i.job_id = j.id
    WHERE j.collection_id = ? AND j.source_dir = ?
  `).get(collectionId, sourceDir) as { jobs: number | null; items: number | null };

  const transaction = db.transaction(() => {
    db.prepare(`
      DELETE FROM kb_ingest_job_items
      WHERE job_id IN (
        SELECT id FROM kb_ingest_jobs WHERE collection_id = ? AND source_dir = ?
      )
    `).run(collectionId, sourceDir);
    db.prepare('DELETE FROM kb_ingest_jobs WHERE collection_id = ? AND source_dir = ?').run(collectionId, sourceDir);
  });
  transaction();

  return {
    cleared_jobs: Number(summary.jobs || 0),
    cleared_items: Number(summary.items || 0),
  };
}
