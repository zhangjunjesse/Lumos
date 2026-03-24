// Task Management 数据库操作

import { getDb } from '@/lib/db/connection';
import type { Task, TaskStatus } from './types';

type TaskManagementTaskRow = {
  id: string;
  session_id: string;
  source_message_id: string | null;
  source_assistant_message_id: string | null;
  summary: string;
  requirements: string;
  status: TaskStatus;
  progress: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  estimated_duration: number | null;
  result: string | null;
  errors: string | null;
  metadata: string | null;
};

// 初始化表
export function initTaskManagementTables() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_management_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source_message_id TEXT,
      source_assistant_message_id TEXT,
      summary TEXT NOT NULL,
      requirements TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      progress INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      estimated_duration INTEGER,
      result TEXT,
      errors TEXT,
      metadata TEXT,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_management_session ON task_management_tasks(session_id);
    CREATE INDEX IF NOT EXISTS idx_task_management_status ON task_management_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_task_management_created ON task_management_tasks(created_at DESC);
  `);

  const columns = db.prepare('PRAGMA table_info(task_management_tasks)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has('source_message_id')) {
    db.exec('ALTER TABLE task_management_tasks ADD COLUMN source_message_id TEXT');
  }
  if (!columnNames.has('source_assistant_message_id')) {
    db.exec('ALTER TABLE task_management_tasks ADD COLUMN source_assistant_message_id TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_management_source_message ON task_management_tasks(session_id, source_message_id, created_at DESC)');
}

// 创建任务
export function createTaskInDb(task: Task): void {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO task_management_tasks (
      id, session_id, source_message_id, source_assistant_message_id, summary, requirements, status, progress,
      created_at, started_at, completed_at, estimated_duration,
      result, errors, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    task.id,
    task.sessionId,
    task.sourceMessageId || null,
    task.sourceAssistantMessageId || null,
    task.summary,
    JSON.stringify(task.requirements),
    task.status,
    task.progress || 0,
    task.createdAt.toISOString(),
    task.startedAt?.toISOString() || null,
    task.completedAt?.toISOString() || null,
    task.estimatedDuration || null,
    task.result ? JSON.stringify(task.result) : null,
    task.errors ? JSON.stringify(task.errors) : null,
    task.metadata ? JSON.stringify(task.metadata) : null
  );
}

// 获取任务
export function getTaskFromDb(taskId: string): Task | null {
  const db = getDb();

  const stmt = db.prepare(`
    SELECT * FROM task_management_tasks WHERE id = ?
  `);

  const row = stmt.get(taskId) as TaskManagementTaskRow | undefined;
  if (!row) return null;

  return rowToTask(row);
}

// 获取所有任务（带过滤）
export function getTasksFromDb(filters: {
  sessionId?: string;
  sourceMessageId?: string;
  status?: TaskStatus[];
  limit?: number;
  offset?: number;
}): { tasks: Task[]; total: number } {
  const db = getDb();

  let whereClause = '';
  const params: unknown[] = [];

  if (filters.sessionId) {
    whereClause += ' WHERE session_id = ?';
    params.push(filters.sessionId);
  }

  if (filters.sourceMessageId) {
    whereClause += whereClause ? ' AND' : ' WHERE';
    whereClause += ' source_message_id = ?';
    params.push(filters.sourceMessageId);
  }

  if (filters.status && filters.status.length > 0) {
    const statusClause = filters.status.map(() => '?').join(',');
    whereClause += whereClause ? ' AND' : ' WHERE';
    whereClause += ` status IN (${statusClause})`;
    params.push(...filters.status);
  }

  // 获取总数
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM task_management_tasks${whereClause}`);
  const { count } = countStmt.get(...params) as { count: number };

  // 获取任务列表
  const limit = Math.min(filters.limit || 20, 100);
  const offset = filters.offset || 0;

  const stmt = db.prepare(`
    SELECT * FROM task_management_tasks${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);

  const rows = stmt.all(...params, limit, offset) as TaskManagementTaskRow[];
  const tasks = rows.map(rowToTask);

  return { tasks, total: count };
}

// 更新任务
export function updateTaskInDb(
  taskId: string,
  updates: Partial<Omit<Task, 'id' | 'sessionId' | 'createdAt'>>
): void {
  const db = getDb();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.summary !== undefined) {
    fields.push('summary = ?');
    values.push(updates.summary);
  }
  if (updates.sourceMessageId !== undefined) {
    fields.push('source_message_id = ?');
    values.push(updates.sourceMessageId || null);
  }
  if (updates.sourceAssistantMessageId !== undefined) {
    fields.push('source_assistant_message_id = ?');
    values.push(updates.sourceAssistantMessageId || null);
  }
  if (updates.requirements !== undefined) {
    fields.push('requirements = ?');
    values.push(JSON.stringify(updates.requirements));
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.progress !== undefined) {
    fields.push('progress = ?');
    values.push(updates.progress);
  }
  if (updates.startedAt !== undefined) {
    fields.push('started_at = ?');
    values.push(updates.startedAt?.toISOString() || null);
  }
  if (updates.completedAt !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completedAt?.toISOString() || null);
  }
  if (updates.estimatedDuration !== undefined) {
    fields.push('estimated_duration = ?');
    values.push(updates.estimatedDuration);
  }
  if (updates.result !== undefined) {
    fields.push('result = ?');
    values.push(updates.result ? JSON.stringify(updates.result) : null);
  }
  if (updates.errors !== undefined) {
    fields.push('errors = ?');
    values.push(updates.errors ? JSON.stringify(updates.errors) : null);
  }
  if (updates.metadata !== undefined) {
    fields.push('metadata = ?');
    values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
  }

  if (fields.length === 0) return;

  values.push(taskId);

  const stmt = db.prepare(`
    UPDATE task_management_tasks
    SET ${fields.join(', ')}
    WHERE id = ?
  `);

  stmt.run(...values);
}

// 辅助函数：将数据库行转换为 Task 对象
function rowToTask(row: TaskManagementTaskRow): Task {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceMessageId: row.source_message_id || undefined,
    sourceAssistantMessageId: row.source_assistant_message_id || undefined,
    summary: row.summary,
    requirements: JSON.parse(row.requirements),
    status: row.status as TaskStatus,
    progress: row.progress,
    createdAt: new Date(row.created_at),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    estimatedDuration: row.estimated_duration ?? undefined,
    result: row.result ? JSON.parse(row.result) : undefined,
    errors: row.errors ? JSON.parse(row.errors) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}
