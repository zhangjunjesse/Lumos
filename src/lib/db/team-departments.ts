import { randomUUID } from 'crypto';
import { getDb } from './index';

export interface TeamDepartment {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface DeptRow {
  id: string; name: string; description: string;
  sort_order: number; created_at: string; updated_at: string;
}

function rowToDept(r: DeptRow): TeamDepartment {
  return { id: r.id, name: r.name, description: r.description, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function listDepartments(): TeamDepartment[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM team_departments ORDER BY sort_order ASC, created_at ASC').all() as DeptRow[];
  return rows.map(rowToDept);
}

export function getDepartment(id: string): TeamDepartment | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM team_departments WHERE id = ?').get(id) as DeptRow | undefined;
  return row ? rowToDept(row) : null;
}

export function createDepartment(input: { name: string; description?: string }): TeamDepartment {
  const db = getDb();
  const id = randomUUID();
  const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM team_departments').get() as { m: number | null };
  const sortOrder = (maxRow.m ?? -1) + 1;
  db.prepare(`INSERT INTO team_departments (id, name, description, sort_order) VALUES (?, ?, ?, ?)`)
    .run(id, input.name, input.description ?? '', sortOrder);
  return getDepartment(id)!;
}

export function updateDepartment(id: string, input: { name?: string; description?: string; sortOrder?: number }): TeamDepartment | null {
  const db = getDb();
  const existing = getDepartment(id);
  if (!existing) return null;
  const name = input.name ?? existing.name;
  const description = input.description ?? existing.description;
  const sortOrder = input.sortOrder ?? existing.sortOrder;
  db.prepare(`UPDATE team_departments SET name=?, description=?, sort_order=?, updated_at=datetime('now') WHERE id=?`)
    .run(name, description, sortOrder, id);
  return getDepartment(id)!;
}

export function deleteDepartment(id: string): void {
  const db = getDb();
  // Unassign members from this department
  db.prepare("UPDATE templates SET department_id=NULL WHERE department_id=? AND type='agent-preset'").run(id);
  db.prepare('DELETE FROM team_departments WHERE id=?').run(id);
}
