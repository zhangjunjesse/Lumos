// 出图团队 CRUD。团队是纯业务数据(名称+成员人设+目标张数),执行引擎见 run-team.ts。
// 默认团队按需 seed:首次读取时不存在就建,用户可改可删(删了再进会重建初始版)。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type AgentTeamRow, type TeamMember, type TeamMemberRole } from '../types';
import { DEFAULT_TEAM_DESCRIPTION, DEFAULT_TEAM_MEMBERS, DEFAULT_TEAM_NAME } from './default-team';

const nowIso = () => new Date().toISOString();

const MEMBER_ROLES: TeamMemberRole[] = ['strategist', 'designer', 'reviewer'];

function sanitizeMembers(input: unknown): TeamMember[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m, i) => ({
      id: typeof m.id === 'string' && m.id ? m.id : `member-${i + 1}-${Date.now()}`,
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : `成员${i + 1}`,
      role: MEMBER_ROLES.includes(m.role as TeamMemberRole) ? (m.role as TeamMemberRole) : 'designer',
      prompt: typeof m.prompt === 'string' ? m.prompt : '',
      enabled: m.enabled !== false,
    }));
}

export function listTeams(store: AppDataStore, userId: string): AgentTeamRow[] {
  ensureDefaultTeam(store, userId);
  return store.query<AgentTeamRow>(COLLECTIONS.AGENT_TEAMS, {
    filter: { user_id: userId },
    orderBy: { field: 'created_at', direction: 'asc' },
    limit: 100,
  });
}

export function getTeam(store: AppDataStore, userId: string, teamId: string): AgentTeamRow | undefined {
  const team = store.get<AgentTeamRow>(COLLECTIONS.AGENT_TEAMS, teamId);
  return team && team.user_id === userId ? team : undefined;
}

// 一键出品用:指定 id → 该团队;没指定 → 默认团队(is_default,兜底第一个)。
export function getEffectiveTeam(store: AppDataStore, userId: string, teamId?: string): AgentTeamRow | undefined {
  if (teamId) return getTeam(store, userId, teamId);
  const teams = listTeams(store, userId);
  return teams.find((t) => t.is_default) ?? teams[0];
}

export function ensureDefaultTeam(store: AppDataStore, userId: string): void {
  const existing = store.query<AgentTeamRow>(COLLECTIONS.AGENT_TEAMS, { filter: { user_id: userId }, limit: 1 });
  if (existing.length > 0) return;
  store.create(COLLECTIONS.AGENT_TEAMS, {
    user_id: userId,
    name: DEFAULT_TEAM_NAME,
    description: DEFAULT_TEAM_DESCRIPTION,
    is_default: true,
    members: DEFAULT_TEAM_MEMBERS,
    images_per_run: 5,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
}

export function createTeam(
  store: AppDataStore,
  userId: string,
  input: { name: string; description?: string; members?: unknown; images_per_run?: number },
): AgentTeamRow {
  const name = input.name?.trim();
  if (!name) throw new Error('团队名不能为空');
  const created = store.create(COLLECTIONS.AGENT_TEAMS, {
    user_id: userId,
    name,
    description: input.description?.trim() || '',
    is_default: false,
    members: sanitizeMembers(input.members),
    images_per_run: clampImagesPerRun(input.images_per_run),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return created as unknown as AgentTeamRow;
}

export function updateTeam(
  store: AppDataStore,
  userId: string,
  teamId: string,
  patch: { name?: string; description?: string; members?: unknown; images_per_run?: number; is_default?: boolean },
): AgentTeamRow {
  const team = getTeam(store, userId, teamId);
  if (!team) throw new Error('团队不存在');
  const next: Partial<AgentTeamRow> = { updated_at: nowIso() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('团队名不能为空');
    next.name = name;
  }
  if (patch.description !== undefined) next.description = patch.description.trim();
  if (patch.members !== undefined) next.members = sanitizeMembers(patch.members);
  if (patch.images_per_run !== undefined) next.images_per_run = clampImagesPerRun(patch.images_per_run);
  if (patch.is_default === true) {
    // 默认团队唯一:先摘掉别家的默认标
    for (const t of store.query<AgentTeamRow>(COLLECTIONS.AGENT_TEAMS, { filter: { user_id: userId, is_default: true }, limit: 100 })) {
      if (t.id !== teamId) store.update(COLLECTIONS.AGENT_TEAMS, t.id, { is_default: false, updated_at: nowIso() });
    }
    next.is_default = true;
  }
  store.update(COLLECTIONS.AGENT_TEAMS, teamId, next);
  const updated = getTeam(store, userId, teamId);
  if (!updated) throw new Error('团队更新后读取失败');
  return updated;
}

export function deleteTeam(store: AppDataStore, userId: string, teamId: string): void {
  const team = getTeam(store, userId, teamId);
  if (!team) return;
  store.delete(COLLECTIONS.AGENT_TEAMS, teamId);
}

function clampImagesPerRun(value?: number): number {
  const n = Math.floor(Number(value ?? 5));
  return Math.max(1, Math.min(12, Number.isFinite(n) ? n : 5));
}
