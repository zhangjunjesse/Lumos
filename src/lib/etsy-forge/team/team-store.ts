// 出图团队 CRUD。团队是纯业务数据(名称+成员人设+目标张数),执行引擎见 run-team.ts。
// 默认团队按需 seed:首次读取时不存在就建,用户可改可删(删了再进会重建初始版)。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type AgentTeamRow, type TeamMember } from '../types';
import { DEFAULT_TEAM_DESCRIPTION, DEFAULT_TEAM_MEMBERS, DEFAULT_TEAM_NAME, DEFAULT_TEAM_SOP } from './default-team';

const nowIso = () => new Date().toISOString();

// 固定角色时代的旧数据兼容:role → 职能描述 + 出图授权。新数据不再写 role。
const LEGACY_ROLE_DUTY: Record<string, string> = {
  strategist: '创意策划:读创作简报,产出创作指令',
  designer: '出图执行:按指令扩写 prompt 并调 generate_image 出图',
  reviewer: '质检评级:逐张看图,评 good/weak',
};

function sanitizeMembers(input: unknown): TeamMember[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m, i) => {
      const legacyRole = typeof m.role === 'string' ? m.role : '';
      const duty = typeof m.duty === 'string' && m.duty.trim()
        ? m.duty.trim()
        : LEGACY_ROLE_DUTY[legacyRole] || '';
      const canGenerateImages = typeof m.canGenerateImages === 'boolean'
        ? m.canGenerateImages
        : legacyRole === 'designer';
      return {
        id: typeof m.id === 'string' && m.id ? m.id : `member-${i + 1}-${Date.now()}`,
        name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : `成员${i + 1}`,
        duty,
        prompt: typeof m.prompt === 'string' ? m.prompt : '',
        canGenerateImages,
        enabled: m.enabled !== false,
      };
    });
}

function sanitizeSop(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

// 读路径统一规范化:老数据(固定 role 时代)在这里转成新形态,调用方永远拿到 duty/canGenerateImages/sop。
function normalizeTeam(row: AgentTeamRow): AgentTeamRow {
  return { ...row, members: sanitizeMembers(row.members), sop: sanitizeSop(row.sop) };
}

export function listTeams(store: AppDataStore, userId: string): AgentTeamRow[] {
  ensureDefaultTeam(store, userId);
  return store
    .query<AgentTeamRow>(COLLECTIONS.AGENT_TEAMS, {
      filter: { user_id: userId },
      orderBy: { field: 'created_at', direction: 'asc' },
      limit: 100,
    })
    .map(normalizeTeam);
}

export function getTeam(store: AppDataStore, userId: string, teamId: string): AgentTeamRow | undefined {
  const team = store.get<AgentTeamRow>(COLLECTIONS.AGENT_TEAMS, teamId);
  return team && team.user_id === userId ? normalizeTeam(team) : undefined;
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
    sop: DEFAULT_TEAM_SOP,
    members: DEFAULT_TEAM_MEMBERS,
    images_per_run: 5,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
}

export function createTeam(
  store: AppDataStore,
  userId: string,
  input: { name: string; description?: string; sop?: string; members?: unknown; images_per_run?: number },
): AgentTeamRow {
  const name = input.name?.trim();
  if (!name) throw new Error('团队名不能为空');
  const created = store.create(COLLECTIONS.AGENT_TEAMS, {
    user_id: userId,
    name,
    description: input.description?.trim() || '',
    is_default: false,
    sop: sanitizeSop(input.sop),
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
  patch: { name?: string; description?: string; sop?: string; members?: unknown; images_per_run?: number; is_default?: boolean },
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
  if (patch.sop !== undefined) next.sop = sanitizeSop(patch.sop);
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
