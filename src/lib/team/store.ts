// 平台团队 CRUD(lumos_teams):团队 = SOP + 成员引用(对话人设库) + 团队级模型。
// 成员本体在 templates(agent-presets),团队只存引用和启停——单一职责,人设改动全团队生效。
// 设计:docs/chat-team-design.md §3。

import { randomUUID } from 'crypto';
import { getDb } from '@/lib/db';
import { getAgentPreset, type AgentPresetDirectoryItem } from '@/lib/db/agent-presets';

export interface TeamMemberRef {
  presetId: string;
  enabled: boolean;
}

export interface PlatformTeam {
  id: string;
  name: string;
  description: string;
  sop: string;
  memberRefs: TeamMemberRef[];
  providerId: string;
  model: string;
  /** 团队默认图片服务商:成员没绑图片服务商时的兜底;空=全局默认 */
  defaultImageProviderId: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 解析后的团队成员:引用 + 人设本体(被删的引用标记 missing,UI 提示降级) */
export interface ResolvedTeamMember {
  ref: TeamMemberRef;
  preset: AgentPresetDirectoryItem | null;
}

interface TeamRow {
  id: string;
  name: string;
  description: string;
  sop: string;
  member_refs: string;
  provider_id: string;
  model: string;
  default_image_provider_id: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

const nowIso = () => new Date().toISOString();

function sanitizeRefs(input: unknown): TeamMemberRef[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof r.presetId === 'string' && !!r.presetId)
    .map((r) => ({ presetId: r.presetId as string, enabled: r.enabled !== false }));
}

function rowToTeam(row: TeamRow): PlatformTeam {
  let refs: TeamMemberRef[] = [];
  try { refs = sanitizeRefs(JSON.parse(row.member_refs)); } catch { /* 脏数据当空 */ }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sop: row.sop,
    memberRefs: refs,
    providerId: row.provider_id,
    model: row.model,
    defaultImageProviderId: row.default_image_provider_id ?? '',
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTeams(): PlatformTeam[] {
  const rows = getDb()
    .prepare('SELECT * FROM lumos_teams ORDER BY created_at ASC')
    .all() as TeamRow[];
  return rows.map(rowToTeam);
}

export function getTeam(id: string): PlatformTeam | null {
  const row = getDb().prepare('SELECT * FROM lumos_teams WHERE id = ?').get(id) as TeamRow | undefined;
  return row ? rowToTeam(row) : null;
}

export interface TeamInput {
  name?: string;
  description?: string;
  sop?: string;
  memberRefs?: unknown;
  providerId?: string;
  model?: string;
  defaultImageProviderId?: string;
  isDefault?: boolean;
}

export function createTeam(input: TeamInput): PlatformTeam {
  const name = input.name?.trim();
  if (!name) throw new Error('团队名不能为空');
  const db = getDb();
  const id = randomUUID();
  const ts = nowIso();
  if (input.isDefault) clearDefaultFlag(db);
  db.prepare(`
    INSERT INTO lumos_teams (id, name, description, sop, member_refs, provider_id, model, default_image_provider_id, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name,
    input.description?.trim() ?? '',
    input.sop ?? '',
    JSON.stringify(sanitizeRefs(input.memberRefs)),
    input.providerId?.trim() ?? '',
    input.model?.trim() ?? '',
    input.defaultImageProviderId?.trim() ?? '',
    input.isDefault ? 1 : 0,
    ts, ts,
  );
  const created = getTeam(id);
  if (!created) throw new Error('团队创建后读取失败');
  return created;
}

export function updateTeam(id: string, patch: TeamInput): PlatformTeam {
  const existing = getTeam(id);
  if (!existing) throw new Error('团队不存在');
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('团队名不能为空');
  const db = getDb();
  if (patch.isDefault === true) clearDefaultFlag(db, id);
  db.prepare(`
    UPDATE lumos_teams SET name = ?, description = ?, sop = ?, member_refs = ?, provider_id = ?, model = ?, default_image_provider_id = ?, is_default = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.name?.trim() ?? existing.name,
    patch.description !== undefined ? patch.description.trim() : existing.description,
    patch.sop !== undefined ? patch.sop : existing.sop,
    JSON.stringify(patch.memberRefs !== undefined ? sanitizeRefs(patch.memberRefs) : existing.memberRefs),
    patch.providerId !== undefined ? patch.providerId.trim() : existing.providerId,
    patch.model !== undefined ? patch.model.trim() : existing.model,
    patch.defaultImageProviderId !== undefined ? patch.defaultImageProviderId.trim() : existing.defaultImageProviderId,
    (patch.isDefault !== undefined ? patch.isDefault : existing.isDefault) ? 1 : 0,
    nowIso(), id,
  );
  const updated = getTeam(id);
  if (!updated) throw new Error('团队更新后读取失败');
  return updated;
}

export function deleteTeam(id: string): boolean {
  return getDb().prepare('DELETE FROM lumos_teams WHERE id = ?').run(id).changes > 0;
}

// 默认团队唯一
function clearDefaultFlag(db: ReturnType<typeof getDb>, exceptId?: string): void {
  if (exceptId) db.prepare('UPDATE lumos_teams SET is_default = 0 WHERE id != ?').run(exceptId);
  else db.prepare('UPDATE lumos_teams SET is_default = 0').run();
}

/** 解析团队成员引用为人设本体;被删的人设保留引用并标 missing(UI 明确降级,运行时跳过)。 */
export function resolveTeamMembers(team: PlatformTeam): ResolvedTeamMember[] {
  return team.memberRefs.map((ref) => ({ ref, preset: getAgentPreset(ref.presetId) }));
}
