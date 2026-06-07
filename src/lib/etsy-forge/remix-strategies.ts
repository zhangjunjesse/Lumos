// 二创方向矩阵策略(动态,存 DB,设置可增删改、可加新方向)。预置 A/B/C/D 四条(对齐 playbook 方向矩阵)。
// runRemix / 图库二创 / 一键出品 都按 code 选用;没选时用 is_default 那条。非自有图红线:跳过 high_similarity 的策略。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type RemixStrategyRow } from './types';
import type { RemixDirection } from './remix-axes';

interface StrategySeed {
  code: string;
  label: string;
  hint: string;
  profile: string;
  use_reference: boolean;
  high_similarity: boolean;
  is_default: boolean;
}

// 预置 4 条 = 原来写死的 REMIX_DIRECTIONS,一字不差搬过来当种子。
export const STRATEGY_SEED: StrategySeed[] = [
  {
    code: 'A',
    label: '同风格低改',
    hint: '系列微调 —— 读起来就是同一张、轻度改进',
    profile:
      'Direction A (same-style light variation / minor refinement): Keep the SAME design almost intact. This is a refinement, not a redesign — it should read as the SAME piece, lightly improved. Keep style, color mood, texture, linework, subject family AND overall composition. Change ONLY small details: minor pose tweaks, local spacing, a few symbol swaps, and the text. Looks like an improved version of the same artwork.\nSimilarity — content: high · composition: high · text: low · unique-symbol-combo: medium · style: high · emotion: high · color-mood: high · texture/linework: high.',
    use_reference: true,
    high_similarity: true,
    is_default: false,
  },
  {
    code: 'B',
    label: '风格一致大改',
    hint: '同一 DNA、做成另一个产品 —— 默认',
    profile:
      'Direction B (same DNA, new product, DEFAULT): Preserve the visual LANGUAGE only — line quality, color mood, texture, illustration style, vibe level and target audience. Build a CLEARLY DIFFERENT product within that language: new motif/subject details, new actions, new composition logic, new symbol arrangement, new layout rhythm, new text. Same shop aesthetic, obviously a separate listing.\nSimilarity — content: low · composition: low · text: low · unique-symbol-combo: low · style: high · emotion: medium-high · color-mood: high · texture/linework: high.',
    use_reference: true,
    high_similarity: false,
    is_default: true,
  },
  {
    code: 'C',
    label: '元素保留风格大改',
    hint: '保留题材卖点、换一套视觉系统 —— 爆款化/换风格',
    profile:
      'Direction C (keep concept, restyle): Keep the CORE THEME, core elements and buyer emotion. Reinterpret everything visual in a NEW style: new linework, new color system, new composition, new rendering. The subject/theme is recognizable, but the look is entirely new.\nSimilarity — content/theme: high · composition: low · text: low · unique-symbol-combo: low · style: low · emotion: medium-high · color-mood: low · texture/linework: low.',
    use_reference: false,
    high_similarity: false,
    is_default: false,
  },
  {
    code: 'D',
    label: '只保留商业语义',
    hint: '只借市场机会重做 —— 相似风险最低',
    profile:
      'Direction D (market-opportunity only): Use the reference ONLY to infer buyer type, emotional value, use case and search intent. The EMOTIONAL HOOK is the single anchor to preserve — everything else is new: new subject, new style, new composition, new text, new symbol system, new palette. Maximum originality, same buyer feeling.\nSimilarity — content: low · composition: low · text: low · unique-symbol-combo: low · style: low · emotion: high · color-mood: low · texture/linework: low.',
    use_reference: false,
    high_similarity: false,
    is_default: false,
  },
  {
    code: 'E4',
    label: '有意义/纪念',
    hint: 'keepsake：里程碑/致敬/in honor of，值得留存',
    profile:
      'Direction E4 (meaningful keepsake): Keep the core subject and visual style, but elevate it into a meaningful keepsake — add quiet symbolic depth and a heartfelt short line so it commemorates a milestone, tribute or "in honor of" moment. Warm, sentimental, worth keeping not just worn.',
    use_reference: true,
    high_similarity: false,
    is_default: false,
  },
  {
    code: 'E5',
    label: '身份共鸣',
    hint: '"这说的就是我"，绑定买家身份/角色/处境',
    profile:
      'Direction E5 (identity resonance): Keep the visual style, but reframe around ONE specific buyer identity or life moment so the wearer instantly feels "this is SO me". Sharpen the subject and any text to express a single clear identity, role or relatable feeling that makes the buyer feel seen.',
    use_reference: true,
    high_similarity: false,
    is_default: false,
  },
  {
    code: 'E6',
    label: '专属/独有感',
    hint: '限量/手作/别处买不到的稀缺与高级',
    profile:
      'Direction E6 (exclusive / one-of-a-kind): Keep the same style family, but elevate it to feel special and exclusive — limited, hand-crafted, "you won\'t find this anywhere else". Add refined, distinctive craft details that signal premium and rare, a clear cut above mass-market designs.',
    use_reference: true,
    high_similarity: false,
    is_default: false,
  },
  {
    code: 'E7',
    label: '送礼场景',
    hint: '为某段关系而设计：for mom/best friend/the [role]',
    profile:
      'Direction E7 (gift for someone): Keep the core art and style, but reframe as a heartfelt gift for a specific relationship (for mom / best friend / partner / the [role]). Bake in the relationship and a warm reason-to-give, with optional short relationship text, so it feels "perfect for ___".',
    use_reference: true,
    high_similarity: false,
    is_default: false,
  },
  {
    code: 'E8',
    label: '个性化定制',
    hint: '预留 name/date/initial/pet name 槽位,可加字定制',
    profile:
      'Direction E8 (personalized / add-your-own): Keep the core art and style, but build it to be personalized — leave a clear, natural slot for a custom name, date, initial or pet name, integrated INTO the composition rather than slapped on top, so "your name here" feels native to the design.',
    use_reference: true,
    high_similarity: false,
    is_default: false,
  },
  {
    code: 'S1',
    label: '简约',
    hint: '极简化:留核心主体、砍繁杂、大留白限色,做干净高级感',
    profile:
      'Direction S1 (minimalist restyle): Keep the CORE subject/theme and buyer emotion, but strip the design down to a clean, minimalist aesthetic. Reduce to the essential shapes and ONE clear focal motif; remove busy backgrounds, ornamental clutter, gradients and heavy texture. Use generous negative space, a limited palette (monochrome or 2-3 flat colors) and clean thin linework; if there is text, set it in refined, modern, well-spaced type. The subject stays recognizable but the look becomes understated, premium and editorial — reads instantly at thumbnail size.\nSimilarity — content/theme: medium-high · composition: low · text: low · unique-symbol-combo: low · style: low · emotion: medium · color-mood: low · texture/linework: low.',
    use_reference: true,
    high_similarity: false,
    is_default: false,
  },
];

const now = () => new Date().toISOString();

function rawStrategies(store: AppDataStore, userId: string): RemixStrategyRow[] {
  return store
    .query<RemixStrategyRow>(COLLECTIONS.REMIX_STRATEGIES, { filter: { user_id: userId }, limit: 500 })
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

// 把种子里「当前库还没有的 code」补进来(不删/不改已有,保留自定义)。返回新增条数。空库时一次补齐全部 = 首播种。
export function topUpStrategies(store: AppDataStore, userId: string): number {
  const have = new Set(rawStrategies(store, userId).map((s) => s.code));
  let added = 0;
  STRATEGY_SEED.forEach((s, i) => {
    if (have.has(s.code)) return;
    store.create(COLLECTIONS.REMIX_STRATEGIES, { user_id: userId, ...s, sort: have.size === 0 ? i : 1000 + i, enabled: true, created_at: now() });
    added++;
  });
  return added;
}

// 读取即补缺:每次列出都确保内置 code 全在(如新增 E4-E8),用户自定义/编辑/排序不动。
export function listStrategies(store: AppDataStore, userId: string): RemixStrategyRow[] {
  topUpStrategies(store, userId);
  return rawStrategies(store, userId);
}

export function createStrategy(store: AppDataStore, userId: string, input: Partial<RemixStrategyRow>): RemixStrategyRow {
  const all = listStrategies(store, userId);
  const row = store.create(COLLECTIONS.REMIX_STRATEGIES, {
    user_id: userId,
    code: input.code || `X${all.length + 1}`,
    label: input.label || '新方向',
    hint: input.hint || '',
    profile: input.profile || '',
    use_reference: input.use_reference ?? true,
    high_similarity: input.high_similarity ?? false,
    is_default: input.is_default ?? false,
    sort: all.length,
    enabled: input.enabled ?? true,
    created_at: now(),
  });
  return row as RemixStrategyRow;
}

export function updateStrategy(store: AppDataStore, userId: string, id: string, patch: Partial<RemixStrategyRow>): boolean {
  const row = store.get<RemixStrategyRow>(COLLECTIONS.REMIX_STRATEGIES, id);
  if (!row || row.user_id !== userId) return false;
  const allowed: Partial<RemixStrategyRow> = {};
  for (const k of ['code', 'label', 'hint', 'profile', 'use_reference', 'high_similarity', 'is_default', 'sort', 'enabled'] as const) {
    if (patch[k] !== undefined) (allowed as Record<string, unknown>)[k] = patch[k];
  }
  store.update(COLLECTIONS.REMIX_STRATEGIES, id, allowed);
  return true;
}

export function deleteStrategy(store: AppDataStore, userId: string, id: string): boolean {
  const row = store.get<RemixStrategyRow>(COLLECTIONS.REMIX_STRATEGIES, id);
  if (!row || row.user_id !== userId) return false;
  return store.delete(COLLECTIONS.REMIX_STRATEGIES, id);
}

const toDirection = (s: RemixStrategyRow): RemixDirection => ({ key: s.code, label: s.label, desc: s.hint, profile: s.profile, useReference: s.use_reference });

// 把选中的 code(或默认)解析成 runRemix 用的方向列表。非自有图:去掉高相似策略(全去掉则退默认)。
export function resolveDirections(store: AppDataStore, userId: string, keys: string[] | undefined, notOwned: boolean): RemixDirection[] {
  const all = listStrategies(store, userId).filter((s) => s.enabled);
  if (all.length === 0) return [];
  let chosen = keys && keys.length ? all.filter((s) => keys.includes(s.code)) : all.filter((s) => s.is_default);
  if (chosen.length === 0) chosen = all.filter((s) => s.is_default);
  if (chosen.length === 0) chosen = [all[0]]; // 没标默认就用第一条
  if (notOwned) {
    const safe = chosen.filter((s) => !s.high_similarity);
    if (safe.length) chosen = safe; // 非自有不做高相似;若全是高相似则保留(总比不出强)
  }
  return chosen.map(toDirection);
}
