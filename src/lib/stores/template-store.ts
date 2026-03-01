/**
 * Template store — CRUD for templates
 */
import { getDb } from '@/lib/db';
import { genId, now } from './helpers';

export interface Template {
  id: string;
  name: string;
  type: string;
  category: string;
  content_skeleton: string;
  system_prompt: string;
  opening_message: string;
  ai_config: string;
  icon: string;
  description: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export type TemplateType = 'document' | 'conversation';
export type TemplateCategory = 'builtin' | 'user';

// ---- Templates ----

export function createTemplate(input: {
  name: string;
  type: TemplateType;
  category?: TemplateCategory;
  content_skeleton?: string;
  system_prompt?: string;
  opening_message?: string;
  ai_config?: Record<string, unknown>;
  icon?: string;
  description?: string;
}): Template {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(`
    INSERT INTO templates (id, name, type, category, content_skeleton, system_prompt, opening_message, ai_config, icon, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.name, input.type,
    input.category || 'user',
    input.content_skeleton || '',
    input.system_prompt || '',
    input.opening_message || '',
    JSON.stringify(input.ai_config || {}),
    input.icon || '📄',
    input.description || '',
    ts, ts,
  );
  return getTemplate(id)!;
}

export function getTemplate(id: string): Template | undefined {
  return getDb().prepare('SELECT * FROM templates WHERE id = ?').get(id) as Template | undefined;
}

export function listTemplates(opts?: {
  type?: TemplateType;
  category?: TemplateCategory;
}): Template[] {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (opts?.type) { wheres.push('type = ?'); params.push(opts.type); }
  if (opts?.category) { wheres.push('category = ?'); params.push(opts.category); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  return getDb().prepare(
    `SELECT * FROM templates ${where} ORDER BY usage_count DESC, updated_at DESC`
  ).all(...params) as Template[];
}

export function updateTemplate(id: string, updates: Partial<{
  name: string; content_skeleton: string; system_prompt: string;
  opening_message: string; ai_config: Record<string, unknown>;
  icon: string; description: string;
}>): Template | undefined {
  const db = getDb();
  const ts = now();
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [ts];

  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.content_skeleton !== undefined) { sets.push('content_skeleton = ?'); vals.push(updates.content_skeleton); }
  if (updates.system_prompt !== undefined) { sets.push('system_prompt = ?'); vals.push(updates.system_prompt); }
  if (updates.opening_message !== undefined) { sets.push('opening_message = ?'); vals.push(updates.opening_message); }
  if (updates.ai_config !== undefined) { sets.push('ai_config = ?'); vals.push(JSON.stringify(updates.ai_config)); }
  if (updates.icon !== undefined) { sets.push('icon = ?'); vals.push(updates.icon); }
  if (updates.description !== undefined) { sets.push('description = ?'); vals.push(updates.description); }

  vals.push(id);
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getTemplate(id);
}

export function incrementTemplateUsage(id: string): void {
  const db = getDb();
  const ts = now();
  db.prepare(
    'UPDATE templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?'
  ).run(ts, id);
}

export function deleteTemplate(id: string): boolean {
  return getDb().prepare('DELETE FROM templates WHERE id = ?').run(id).changes > 0;
}
