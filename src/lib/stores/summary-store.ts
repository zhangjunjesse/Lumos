/**
 * Summary store — CRUD for kb_summaries
 */
import { getDb } from '@/lib/db';
import { genId, now } from './helpers';

export interface KbSummary {
  id: string;
  scope: string;
  scope_id: string;
  summary: string;
  key_points: string;
  model: string;
  token_cost: number;
  created_at: string;
  updated_at: string;
}

export type SummaryScope = 'item' | 'tag' | 'weekly';

// ---- Summaries ----

export function upsertSummary(input: {
  scope: SummaryScope;
  scope_id: string;
  summary: string;
  key_points?: string[];
  model?: string;
  token_cost?: number;
}): KbSummary {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(`
    INSERT INTO kb_summaries (id, scope, scope_id, summary, key_points, model, token_cost, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, scope_id) DO UPDATE SET
      summary = excluded.summary,
      key_points = excluded.key_points,
      model = excluded.model,
      token_cost = excluded.token_cost,
      updated_at = excluded.updated_at
  `).run(
    id, input.scope, input.scope_id, input.summary,
    JSON.stringify(input.key_points || []),
    input.model || 'haiku',
    input.token_cost || 0,
    ts, ts,
  );
  return getSummaryByScope(input.scope, input.scope_id)!;
}

export function getSummary(id: string): KbSummary | undefined {
  return getDb().prepare('SELECT * FROM kb_summaries WHERE id = ?').get(id) as KbSummary | undefined;
}

export function getSummaryByScope(scope: string, scopeId: string): KbSummary | undefined {
  return getDb().prepare(
    'SELECT * FROM kb_summaries WHERE scope = ? AND scope_id = ?'
  ).get(scope, scopeId) as KbSummary | undefined;
}

export function listSummaries(opts?: {
  scope?: SummaryScope; limit?: number; offset?: number;
}): KbSummary[] {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (opts?.scope) { wheres.push('scope = ?'); params.push(opts.scope); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;
  return getDb().prepare(
    `SELECT * FROM kb_summaries ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as KbSummary[];
}

export function deleteSummary(id: string): boolean {
  return getDb().prepare('DELETE FROM kb_summaries WHERE id = ?').run(id).changes > 0;
}

export function deleteSummaryByScope(scope: string, scopeId: string): boolean {
  return getDb().prepare(
    'DELETE FROM kb_summaries WHERE scope = ? AND scope_id = ?'
  ).run(scope, scopeId).changes > 0;
}
