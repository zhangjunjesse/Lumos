/**
 * Workspace store — CRUD for workspaces + workspace_files
 */
import { getDb } from '@/lib/db';
import { genId, now } from './helpers';

export interface Workspace {
  id: string;
  name: string;
  path: string;
  include_patterns: string;
  exclude_patterns: string;
  status: string;
  file_count: number;
  indexed_count: number;
  last_scanned_at: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceFile {
  id: string;
  workspace_id: string;
  relative_path: string;
  file_hash: string;
  file_size: number;
  kb_status: string;
  kb_item_id: string | null;
  file_modified_at: string | null;
  last_indexed_at: string | null;
  created_at: string;
}

// ---- Workspaces ----

export function createWorkspace(name: string, wsPath: string): Workspace {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(`
    INSERT INTO workspaces (id, name, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, wsPath, ts, ts);
  return getWorkspace(id)!;
}

export function getWorkspace(id: string): Workspace | undefined {
  return getDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | undefined;
}

export function getWorkspaceByPath(wsPath: string): Workspace | undefined {
  return getDb().prepare('SELECT * FROM workspaces WHERE path = ?').get(wsPath) as Workspace | undefined;
}

export function listWorkspaces(): Workspace[] {
  return getDb().prepare(
    'SELECT * FROM workspaces ORDER BY is_active DESC, updated_at DESC'
  ).all() as Workspace[];
}

export function getActiveWorkspace(): Workspace | undefined {
  return getDb().prepare(
    'SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1'
  ).get() as Workspace | undefined;
}

export function setActiveWorkspace(id: string): void {
  const db = getDb();
  const ts = now();
  db.transaction(() => {
    db.prepare('UPDATE workspaces SET is_active = 0').run();
    db.prepare('UPDATE workspaces SET is_active = 1, updated_at = ? WHERE id = ?').run(ts, id);
  })();
}

export function updateWorkspace(id: string, updates: Partial<{
  name: string; status: string;
  include_patterns: string[]; exclude_patterns: string[];
  file_count: number; indexed_count: number;
  last_scanned_at: string;
}>): Workspace | undefined {
  const db = getDb();
  const ts = now();
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [ts];

  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
  if (updates.include_patterns !== undefined) { sets.push('include_patterns = ?'); vals.push(JSON.stringify(updates.include_patterns)); }
  if (updates.exclude_patterns !== undefined) { sets.push('exclude_patterns = ?'); vals.push(JSON.stringify(updates.exclude_patterns)); }
  if (updates.file_count !== undefined) { sets.push('file_count = ?'); vals.push(updates.file_count); }
  if (updates.indexed_count !== undefined) { sets.push('indexed_count = ?'); vals.push(updates.indexed_count); }
  if (updates.last_scanned_at !== undefined) { sets.push('last_scanned_at = ?'); vals.push(updates.last_scanned_at); }

  vals.push(id);
  db.prepare(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getWorkspace(id);
}

export function deleteWorkspace(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM workspace_files WHERE workspace_id = ?').run(id);
  return db.prepare('DELETE FROM workspaces WHERE id = ?').run(id).changes > 0;
}

// ---- Workspace Files ----

export function upsertWorkspaceFile(workspaceId: string, input: {
  relative_path: string;
  file_hash: string;
  file_size: number;
  file_modified_at?: string;
}): WorkspaceFile {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(`
    INSERT INTO workspace_files (id, workspace_id, relative_path, file_hash, file_size, file_modified_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, relative_path) DO UPDATE SET
      file_hash = excluded.file_hash,
      file_size = excluded.file_size,
      file_modified_at = excluded.file_modified_at
  `).run(id, workspaceId, input.relative_path, input.file_hash, input.file_size, input.file_modified_at || null, ts);

  return getWorkspaceFile(workspaceId, input.relative_path)!;
}

export function getWorkspaceFile(workspaceId: string, relativePath: string): WorkspaceFile | undefined {
  return getDb().prepare(
    'SELECT * FROM workspace_files WHERE workspace_id = ? AND relative_path = ?'
  ).get(workspaceId, relativePath) as WorkspaceFile | undefined;
}

export function listWorkspaceFiles(workspaceId: string, opts?: {
  kb_status?: string; limit?: number; offset?: number;
}): WorkspaceFile[] {
  const wheres = ['workspace_id = ?'];
  const params: unknown[] = [workspaceId];
  if (opts?.kb_status) { wheres.push('kb_status = ?'); params.push(opts.kb_status); }
  const limit = opts?.limit || 500;
  const offset = opts?.offset || 0;
  return getDb().prepare(
    `SELECT * FROM workspace_files WHERE ${wheres.join(' AND ')} ORDER BY relative_path ASC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as WorkspaceFile[];
}

export function updateWorkspaceFileStatus(id: string, updates: {
  kb_status?: string; kb_item_id?: string | null; last_indexed_at?: string;
}): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.kb_status !== undefined) { sets.push('kb_status = ?'); vals.push(updates.kb_status); }
  if (updates.kb_item_id !== undefined) { sets.push('kb_item_id = ?'); vals.push(updates.kb_item_id); }
  if (updates.last_indexed_at !== undefined) { sets.push('last_indexed_at = ?'); vals.push(updates.last_indexed_at); }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE workspace_files SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteWorkspaceFile(id: string): boolean {
  return getDb().prepare('DELETE FROM workspace_files WHERE id = ?').run(id).changes > 0;
}
