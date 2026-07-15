// 出图团队 CRUD。团队是纯业务数据(名称+成员人设+目标张数),执行引擎见 run-team.ts。
// 默认团队按需 seed:首次读取时不存在就建,用户可改可删(删了再进会重建初始版)。

import crypto from 'node:crypto';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type AgentTeamRow, type TeamMember } from '../types';
import { BUILTIN_TEAMS, type BuiltinTeamDef } from './builtin';

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
function sanitizeModelRef(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeTeam(row: AgentTeamRow): AgentTeamRow {
  return {
    ...row,
    members: sanitizeMembers(row.members),
    sop: sanitizeSop(row.sop),
    provider_id: sanitizeModelRef(row.provider_id),
    model: sanitizeModelRef(row.model),
  };
}

export function listTeams(store: AppDataStore, userId: string): AgentTeamRow[] {
  ensureBuiltinTeams(store, userId);
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

// 内置团队内容指纹:seed 时存进行里;行内容仍等于它=用户没改过。只哈希"内容"字段,
// 用户改 is_default/provider/model 这类偏好不影响内置定义升级时的安全刷新。
function builtinContentHash(input: {
  sop: string;
  description: string;
  imagesPerRun: number;
  members: Array<Pick<TeamMember, 'name' | 'duty' | 'prompt' | 'canGenerateImages' | 'enabled'>>;
}): string {
  const normalized = {
    sop: input.sop.trim(),
    description: input.description.trim(),
    imagesPerRun: input.imagesPerRun,
    members: input.members.map((m) => ({
      name: m.name, duty: m.duty, prompt: m.prompt,
      canGenerateImages: m.canGenerateImages, enabled: m.enabled,
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function defHash(def: BuiltinTeamDef): string {
  return builtinContentHash({ sop: def.sop, description: def.description, imagesPerRun: def.imagesPerRun, members: def.members });
}

function rowHash(row: AgentTeamRow): string {
  return builtinContentHash({
    sop: sanitizeSop(row.sop),
    description: typeof row.description === 'string' ? row.description : '',
    imagesPerRun: typeof row.images_per_run === 'number' ? row.images_per_run : 5,
    members: sanitizeMembers(row.members),
  });
}

// 补齐内置团队:按名字 create-if-missing + pristine 刷新。
// - 用户没有的同名团队 → 补建(新增内置团队时老用户下次进来自动补上)。
// - 已有且用户从没改过内容(行哈希==seed 指纹;老行无指纹则看 updated_at==created_at) →
//   内置定义升级时安全刷新到新版。
// - 用户改过内容(改名/改SOP/改成员) → 视为用户资产,绝不覆盖。
// 首个内置团队(默认款)在用户尚无任何默认团队时补上 is_default。
export function ensureBuiltinTeams(store: AppDataStore, userId: string): void {
  const existing = store.query<AgentTeamRow>(COLLECTIONS.AGENT_TEAMS, { filter: { user_id: userId }, limit: 200 });
  const hasDefault = existing.some((t) => t.is_default);
  // 批量 seed 会在同一毫秒落库 → created_at 相同则 ORDER BY 顺序不定。给每个内置团队
  // 递增时间戳,保证列表按 BUILTIN_TEAMS 定义顺序稳定展示(默认款始终排第一)。
  const baseMs = Date.now();

  BUILTIN_TEAMS.forEach((def, i) => {
    const row = existing.find((t) => t.name === def.name);
    const targetHash = defHash(def);
    if (row) {
      const currentHash = rowHash(row);
      if (currentHash === targetHash) {
        // 内容已是最新;老行(seed 时还没有指纹机制)补个指纹,让以后的升级判断走哈希而不是时间戳。
        if (row.builtin_hash !== targetHash) store.update(COLLECTIONS.AGENT_TEAMS, row.id, { builtin_hash: targetHash });
        return;
      }
      const pristine = row.builtin_hash ? row.builtin_hash === currentHash : row.updated_at === row.created_at;
      if (!pristine) return; // 用户资产,不碰
      store.update(COLLECTIONS.AGENT_TEAMS, row.id, {
        description: def.description,
        sop: def.sop,
        members: def.members,
        images_per_run: def.imagesPerRun,
        builtin_hash: targetHash,
        updated_at: nowIso(),
      });
      return;
    }
    const ts = new Date(baseMs + i).toISOString();
    store.create(COLLECTIONS.AGENT_TEAMS, {
      user_id: userId,
      name: def.name,
      description: def.description,
      is_default: def.isDefault === true && !hasDefault,
      sop: def.sop,
      members: def.members,
      images_per_run: def.imagesPerRun,
      builtin_hash: targetHash,
      created_at: ts,
      updated_at: ts,
    });
  });
}

export function createTeam(
  store: AppDataStore,
  userId: string,
  input: { name: string; description?: string; sop?: string; members?: unknown; images_per_run?: number; provider_id?: string; model?: string },
): AgentTeamRow {
  const name = input.name?.trim();
  if (!name) throw new Error('团队名不能为空');
  const created = store.create(COLLECTIONS.AGENT_TEAMS, {
    user_id: userId,
    name,
    description: input.description?.trim() || '',
    is_default: false,
    sop: sanitizeSop(input.sop),
    provider_id: sanitizeModelRef(input.provider_id),
    model: sanitizeModelRef(input.model),
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
  patch: { name?: string; description?: string; sop?: string; members?: unknown; images_per_run?: number; is_default?: boolean; provider_id?: string; model?: string },
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
  if (patch.provider_id !== undefined) next.provider_id = sanitizeModelRef(patch.provider_id);
  if (patch.model !== undefined) next.model = sanitizeModelRef(patch.model);
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
