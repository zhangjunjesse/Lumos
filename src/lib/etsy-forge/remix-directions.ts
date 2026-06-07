// 裂变·方向库(动态,存 DB,可在「方向库管理」增删改)。预置 playbook remix_direction_library.md 的 8 轴 ~34 个方向。
// 诊断只能从「当前库」里选方向(红线:不发明库外方向)。轴(A-H)用于规则判定 叠加/平行/矩阵。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type RemixDirectionRow } from './types';

export interface DirectionSeed {
  axis: string; // A-H
  axisName: string; // 轴中文名
  code: string; // A1...
  label: string; // 中文方向名
  hint: string; // 中文一句话作用
  fragment: string; // 英文出图指令片段
}

// 8 轴 · 与 playbook 同源(宝典七要素 + 印花专属)。fragment 是注入出图 prompt 的英文片段。
export const DIRECTION_SEED: DirectionSeed[] = [
  { axis: 'A', axisName: '构图/角度', code: 'A1', label: '强主次', hint: '放大主体当视觉中心，治"太平没重心"', fragment: 'make the main subject the dominant visual center; strengthen the focal hierarchy' },
  { axis: 'A', axisName: '构图/角度', code: 'A2', label: '疏密呼吸', hint: '中间密、向外渐疏，治"留白碎"', fragment: 'dense at the center and gradually sparser outward; add breathing room' },
  { axis: 'A', axisName: '构图/角度', code: 'A3', label: '中心聚合', hint: '满版散布→集中成胸前主图', fragment: 'gather the scattered elements into one centered chest graphic' },
  { axis: 'A', axisName: '构图/角度', code: 'A4', label: '对称/秩序', hint: '网格、镜像、标本式排列', fragment: 'arrange with symmetry / grid / knolling specimen-style order' },
  { axis: 'A', axisName: '构图/角度', code: 'A5', label: '负空间留白', hint: '敢空，做高级感', fragment: 'embrace generous negative space for a premium, airy feel' },
  { axis: 'A', axisName: '构图/角度', code: 'A6', label: '手绘随机散布', hint: '破规整网格，手摆压花感', fragment: 'break the rigid grid; hand-placed, pressed-flower random scatter' },
  { axis: 'A', axisName: '构图/角度', code: 'A7', label: '视角变化', hint: '特写/平铺俯视/框形包围', fragment: 'change the viewpoint: close-up / top-down flat-lay / framed border' },
  { axis: 'B', axisName: '颜色/配色', code: 'B1', label: '提高对比', hint: '吸睛、缩略图更强', fragment: 'increase color contrast for stronger thumbnail pop' },
  { axis: 'B', axisName: '颜色/配色', code: 'B2', label: '统一灰调/莫兰迪', hint: '像一个人画的，高级', fragment: 'unify into a muted Morandi palette so it looks made by one hand' },
  { axis: 'B', axisName: '颜色/配色', code: 'B3', label: '复古褪色', hint: 'retro faded', fragment: 'retro faded vintage colors' },
  { axis: 'B', axisName: '颜色/配色', code: 'B4', label: '限色 2-3 色', hint: '印刷友好、爆款友好', fragment: 'limit to a 2-3 color print-friendly palette' },
  { axis: 'B', axisName: '颜色/配色', code: 'B5', label: '暖调转向', hint: '情绪偏温暖', fragment: 'shift the palette warmer' },
  { axis: 'B', axisName: '颜色/配色', code: 'B6', label: '冷调转向', hint: '情绪偏清冷', fragment: 'shift the palette cooler' },
  { axis: 'B', axisName: '颜色/配色', code: 'B7', label: '节日配色', hint: '万圣/圣诞/复活节等', fragment: 'apply a holiday palette (Halloween / Christmas / Easter as appropriate)' },
  { axis: 'C', axisName: '风格/媒介', code: 'C1', label: '同风格微调', hint: '保审美，只优化结构', fragment: 'keep the same visual style; only refine the structure' },
  { axis: 'C', axisName: '风格/媒介', code: 'C2', label: '媒介转译', hint: '水彩↔线稿↔刺绣↔贴纸↔矢量', fragment: 'translate the medium (e.g. watercolor / clean line art / embroidery / sticker / vector)' },
  { axis: 'C', axisName: '风格/媒介', code: 'C3', label: '风格大改', hint: '复古丝印/kawaii/Y2K/极简/黑白漫画', fragment: 'major restyle (retro screen-print / kawaii / Y2K / minimal icon / black-and-white manga)' },
  { axis: 'C', axisName: '风格/媒介', code: 'C4', label: '贴纸化', hint: '粗轮廓+简化细节', fragment: 'sticker style: bold outline and simplified details' },
  { axis: 'D', axisName: '质感/肌理/光线', code: 'D1', label: '加颗粒做旧', hint: '增加 vintage 颗粒', fragment: 'add vintage grain and distress texture' },
  { axis: 'D', axisName: '质感/肌理/光线', code: 'D2', label: '干净矢量化', hint: '去杂质，更清爽', fragment: 'clean vectorize; remove noise and artifacts' },
  { axis: 'D', axisName: '质感/肌理/光线', code: 'D3', label: '强化手绘温度', hint: '强化笔触、手作感', fragment: 'strengthen the hand-drawn strokes and handmade warmth' },
  { axis: 'E', axisName: '创意钩子', code: 'E1', label: '不常见设定', hint: '意料之外但能懂', fragment: 'an uncommon, unexpected-but-understandable concept' },
  { axis: 'E', axisName: '创意钩子', code: 'E2', label: '反差', hint: '暗黑+甜美/可爱+摆烂/凶猛+温柔', fragment: 'a strong contrast (dark+sweet / cute+slacker / sacred+funny / fierce+gentle)' },
  { axis: 'E', axisName: '创意钩子', code: 'E3', label: '情绪转向', hint: '甜美→讽刺/复古→现代梗', fragment: 'a mood shift (sweet→sarcastic / cute→slacker / vintage→modern-meme / dark→healing)' },
  { axis: 'E', axisName: '创意钩子', code: 'E4', label: '有意义/纪念', hint: '升级成 keepsake：里程碑/致敬/in honor of，值得留存', fragment: 'elevate into a MEANINGFUL KEEPSAKE: keep the core subject and style but add quiet symbolic depth and a heartfelt short line, so it commemorates a milestone / tribute / "in honor of" moment — warm, sentimental, worth keeping not just worn' },
  { axis: 'E', axisName: '创意钩子', code: 'E5', label: '身份共鸣', hint: '"这说的就是我"，绑定买家身份/角色/处境', fragment: 'reframe around ONE specific buyer identity or life moment so the wearer instantly feels "this is SO me": sharpen the subject and any text to express a single clear identity, role or relatable feeling that makes the buyer feel seen' },
  { axis: 'E', axisName: '创意钩子', code: 'E6', label: '专属/独有感', hint: '限量/手作/别处买不到的稀缺与高级', fragment: 'make it feel SPECIAL and EXCLUSIVE — limited, hand-crafted, "you won\'t find this anywhere else": keep the style family but add refined, distinctive craft details that signal premium and rare, a clear cut above mass-market designs' },
  { axis: 'E', axisName: '创意钩子', code: 'E7', label: '送礼场景', hint: '为某段关系而设计：for mom/best friend/the [role]', fragment: 'reframe as a HEARTFELT GIFT for a specific relationship (for mom / best friend / partner / the [role]): bake in the relationship and a warm reason-to-give, with optional short relationship text, so the buyer thinks "this is perfect for ___"' },
  { axis: 'E', axisName: '创意钩子', code: 'E8', label: '个性化定制', hint: '预留 name/date/initial/pet name 槽位,可加字定制', fragment: 'build it to be PERSONALIZED: leave a clear, natural slot for a custom name / date / initial / pet name, integrated INTO the composition (not slapped on top), so "your name here" feels native to the design' },
  { axis: 'F', axisName: '主体/内容', code: 'F1', label: '减少主体数', hint: '去拥挤', fragment: 'reduce the number of subjects to de-clutter' },
  { axis: 'F', axisName: '主体/内容', code: 'F2', label: '放大单一主体', hint: '做强中心', fragment: 'enlarge a single subject to make a strong center' },
  { axis: 'F', axisName: '主体/内容', code: 'F3', label: '主配角拉层级', hint: '主体大、配角小', fragment: 'establish hierarchy: big hero subject, smaller secondary elements' },
  { axis: 'F', axisName: '主体/内容', code: 'F4', label: '换主体保风格', hint: '风格不变，换画的东西', fragment: 'swap the main subject while keeping the style' },
  { axis: 'G', axisName: '文案/排版', code: 'G1', label: '字体气质调整', hint: '换字体/字重/字距', fragment: 'adjust the lettering: font style / weight / spacing' },
  { axis: 'G', axisName: '文案/排版', code: 'G2', label: '文字与图比重', hint: '文字占比加大或缩小', fragment: 'change the text-to-graphic ratio (larger or smaller text)' },
  { axis: 'G', axisName: '文案/排版', code: 'G3', label: '去文案纯图版', hint: '完全去掉文字', fragment: 'remove all text for a pure graphic version' },
  { axis: 'H', axisName: '印花适配', code: 'H1', label: '去背景净化', hint: '透明背景、去暗角', fragment: 'transparent background; remove vignette; clean edges' },
  { axis: 'H', axisName: '印花适配', code: 'H2', label: '缩略图可读', hint: '远看清楚、轮廓清晰', fragment: 'clarify the silhouette so it reads clearly at thumbnail size' },
  { axis: 'H', axisName: '印花适配', code: 'H3', label: '系列化预留', hint: '为做系列留统一接口', fragment: 'keep a consistent visual interface suitable for extending into a series' },
];

const now = () => new Date().toISOString();

function rawDirections(store: AppDataStore, userId: string): RemixDirectionRow[] {
  return store
    .query<RemixDirectionRow>(COLLECTIONS.REMIX_DIRECTIONS, { filter: { user_id: userId }, limit: 500 })
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

// 把种子里「当前库还没有的 code」补进去(不删、不改已有,保留用户自定义)。返回新增条数。
// 空库时一次补齐全部 = 首播种;库已有旧版时,内置新增的方向(如 E4-E8)也会被补上。
export function topUpBuiltins(store: AppDataStore, userId: string): number {
  const have = new Set(rawDirections(store, userId).map((d) => d.code));
  const fresh = have.size === 0;
  let added = 0;
  DIRECTION_SEED.forEach((d, i) => {
    if (have.has(d.code)) return;
    store.create(COLLECTIONS.REMIX_DIRECTIONS, {
      user_id: userId,
      axis: d.axis,
      axis_name: d.axisName,
      code: d.code,
      label: d.label,
      hint: d.hint,
      prompt_fragment: d.fragment,
      sort: fresh ? i : 1000 + i, // 首播种按序;补缺排到后面,不打乱已有顺序
      enabled: true,
      created_at: now(),
    });
    added++;
  });
  return added;
}

// 读取即补缺:每次列出都确保内置 code 全在(如新增 E4-E8),用户自定义/编辑/排序不动。
export function listDirections(store: AppDataStore, userId: string): RemixDirectionRow[] {
  topUpBuiltins(store, userId);
  return rawDirections(store, userId);
}

export function createDirection(store: AppDataStore, userId: string, input: Partial<RemixDirectionRow>): RemixDirectionRow {
  const all = listDirections(store, userId);
  const row = store.create(COLLECTIONS.REMIX_DIRECTIONS, {
    user_id: userId,
    axis: (input.axis || 'A').toString().toUpperCase().slice(0, 1),
    axis_name: input.axis_name || '自定义',
    code: input.code || `X${all.length + 1}`,
    label: input.label || '新方向',
    hint: input.hint || '',
    prompt_fragment: input.prompt_fragment || '',
    sort: all.length,
    enabled: input.enabled ?? true,
    created_at: now(),
  });
  return row as RemixDirectionRow;
}

export function updateDirection(store: AppDataStore, userId: string, id: string, patch: Partial<RemixDirectionRow>): boolean {
  const row = store.get<RemixDirectionRow>(COLLECTIONS.REMIX_DIRECTIONS, id);
  if (!row || row.user_id !== userId) return false;
  const allowed: Partial<RemixDirectionRow> = {};
  for (const k of ['axis', 'axis_name', 'code', 'label', 'hint', 'prompt_fragment', 'sort', 'enabled'] as const) {
    if (patch[k] !== undefined) (allowed as Record<string, unknown>)[k] = patch[k];
  }
  store.update(COLLECTIONS.REMIX_DIRECTIONS, id, allowed);
  return true;
}

export function deleteDirection(store: AppDataStore, userId: string, id: string): boolean {
  const row = store.get<RemixDirectionRow>(COLLECTIONS.REMIX_DIRECTIONS, id);
  if (!row || row.user_id !== userId) return false;
  return store.delete(COLLECTIONS.REMIX_DIRECTIONS, id);
}
