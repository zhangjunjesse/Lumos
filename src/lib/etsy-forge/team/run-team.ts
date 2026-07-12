// 一键出品第⑦步「团队出图」编排:前置校验与创作简报沿用二创的拆解生态
// (vision 拆解/市场验证/IP 红线),创作本身交给出图团队(team-session),
// 产物按老契约写 assets(category=remix),下游图库/出产品图零改动。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import fs from 'fs';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEffectivePrompt } from '../prompt-defaults';
import { loadImageAsBase64, type FetchedImage } from '../image-fetch';
import {
  analyzeForRemix,
  factsBriefText,
  nicheText,
  hookText,
  paletteText,
  buildRiskRule,
  stickerConcerns,
  fallbackAnalysis,
  type RemixAnalysis,
} from '../remix-analyze';
import { judgeRemix } from '../remix-qa';
import { resolveVisionEndpoint } from '../vision-provider';
import { buildMarketValidation } from '../market-validation';
import { logEvent } from '../log';
import { COLLECTIONS, type AssetRow, type CutoutRow, type ProductRow } from '../types';
import { getEffectiveTeam } from './team-store';
import { runTeamSession, type TeamDesignOutput, type TeamEvent } from './team-session';

export interface RunTeamRemixResult {
  ok: boolean;
  created: number;
  failed: number;
  error?: string;
}

const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

export async function runTeamRemix(
  store: AppDataStore,
  input: { userId: string; productId: string; teamId?: string; count?: number },
): Promise<RunTeamRemixResult> {
  const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId);
  if (!product || product.user_id !== input.userId) return fail('商品不存在');

  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) return fail('未配置图片服务商。去「设置 → 图片生成」选一个。');

  const team = getEffectiveTeam(store, input.userId, input.teamId);
  if (!team) return fail('没有可用的出图团队(去「出图团队」建一个)');

  const cutout = store.query<CutoutRow>(COLLECTIONS.CUTOUTS, {
    filter: { product_id: input.productId, status: 'success' },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 1,
  })[0];
  if (!cutout?.cutout_path) return fail('该商品还没有抠出的印花,先抠印花再出图');

  let designImg: FetchedImage;
  try {
    designImg = await loadImageAsBase64({ localPath: cutout.cutout_path, url: serve(cutout.cutout_path) });
  } catch (err) {
    return fail(`读取印花失败:${message(err)}`);
  }

  // 拆解沿用二创生态:vision 出结构化分析,失败降级标题简报(如实记,不假装)。
  const vision = resolveVisionEndpoint(store);
  const mv = buildMarketValidation(product.review_analysis);
  let analysis: RemixAnalysis;
  try {
    if (!vision.ok) throw new Error(vision.error);
    analysis = await analyzeForRemix(vision.ep, designImg, getEffectivePrompt(store, input.userId, 'remix-analyze'), mv.promptSection || undefined);
    logEvent('团队出图', 'info', `商品 ${product.title || input.productId} 拆解完成:${analysis.niches.length} niche · ${analysis.hooks.length} 钩子`, product.title);
  } catch (err) {
    logEvent('团队出图', 'warn', `拆解失败,降级用标题:${message(err)}`, product.title);
    analysis = fallbackAnalysis(product.title || '');
  }
  const concerns = stickerConcerns(analysis);
  if (concerns.length >= 2) {
    logEvent('团队出图', 'warn', `贴纸化存疑(${concerns.join('/')}),仍照常生成`, product.title);
  }

  const targetCount = Math.max(1, Math.min(12, Math.floor(input.count ?? team.images_per_run ?? 5)));
  const briefing = buildBriefing(product, cutout.cutout_path, analysis, mv.verified, targetCount);

  logEvent('团队出图', 'info', `团队「${team.name}」开工:目标 ${targetCount} 张 · 成员 ${team.members.filter((m) => m.enabled).length} 名 · 模型 ${team.model || '(全局默认)'}`, product.title);
  let designs: TeamDesignOutput[];
  let summary: string;
  try {
    const session = await runTeamSession({
      team,
      briefing,
      targetCount,
      userId: input.userId,
      onEvent: (ev) => logTeamEvent(ev, product.title),
    });
    designs = session.designs;
    summary = session.summary;
    logEvent('团队出图', 'info', `团队「${team.name}」交付 ${designs.length}/${targetCount} 张(出图调用 ${session.imageCallsUsed} 次):${summary}`, product.title);
  } catch (err) {
    logEvent('团队出图', 'error', `团队「${team.name}」执行失败:${message(err)}`, product.title);
    return fail(message(err));
  }

  const valid = designs.filter((d) => fs.existsSync(d.path));
  if (valid.length === 0) {
    return fail(`团队没有产出有效设计图${summary ? `:${summary}` : ''}`);
  }

  // 重跑覆盖:删旧 remix 素材(保留系列化扩展,对齐 runRemix)。
  const old = store.query<AssetRow>(COLLECTIONS.ASSETS, { filter: { user_id: input.userId, product_id: input.productId, category: 'remix' }, limit: 200 });
  for (const o of old) if (!o.series_of) store.delete(COLLECTIONS.ASSETS, o.id);

  for (const d of valid) {
    const qa = await resolveVerdict(d, vision, analysis);
    store.create(COLLECTIONS.ASSETS, {
      user_id: input.userId,
      category: 'remix',
      product_id: input.productId,
      description: `团队出图·${d.member}:${d.rationale}`.slice(0, 300),
      source_image_ids: [],
      image_path: d.path,
      status: 'success',
      quality_flag: qa.flag,
      quality_note: qa.note,
      created_at: new Date().toISOString(),
    });
  }

  return { ok: true, created: valid.length, failed: Math.max(0, targetCount - valid.length) };
}

// 评级:团队交差里带了评级就用它(SOP 决定谁评/评不评);没带时走既有 judgeRemix 质量闸门兜底,闸门不缺席。
async function resolveVerdict(
  d: TeamDesignOutput,
  vision: ReturnType<typeof resolveVisionEndpoint>,
  analysis: RemixAnalysis,
): Promise<{ flag: 'good' | 'weak'; note: string }> {
  if (d.verdict === 'good' || d.verdict === 'weak') {
    return { flag: d.verdict, note: d.verdict_note || '' };
  }
  if (!vision.ok) return { flag: 'good', note: '' };
  try {
    const img = await loadImageAsBase64({ localPath: d.path, url: serve(d.path) });
    return await judgeRemix(vision.ep, img, analysis.type);
  } catch {
    return { flag: 'good', note: '' };
  }
}

function buildBriefing(product: ProductRow, cutoutPath: string, analysis: RemixAnalysis, verified: boolean, targetCount: number): string {
  const list = (items: string[]) => (items.length ? items.map((s) => `- ${s}`).join('\n') : '- (无,自行推断)');
  return [
    `商品标题: ${product.title || '(无)'}`,
    `目标张数: ${targetCount}`,
    `参考印花路径: ${cutoutPath}`,
    '',
    `事实简报:\n${factsBriefText(analysis)}`,
    '',
    `目标买家(niche,${verified ? '已用真实评论验证' : '基于推断,未验证'}):\n${list(analysis.niches.map(nicheText))}`,
    '',
    `创意钩子:\n${list(analysis.hooks.map(hookText))}`,
    '',
    `配色方向:\n${list(analysis.palettes.map(paletteText))}`,
    '',
    `风险规则(必须遵守):\n${buildRiskRule(analysis)}`,
    analysis.ownership === 'not-owned' ? '\n注意:参考图非自有,禁止高相似复刻,以发散创作为主。' : '',
  ].join('\n');
}

// 把团队执行事件翻成应用日志——用户在「日志」tab 就能看队长派了谁、谁在出图、卡在哪。
function logTeamEvent(ev: TeamEvent, product?: string): void {
  switch (ev.kind) {
    case 'dispatch':
      return logEvent('团队·派单', 'info', `队长 → ${ev.to}:${ev.task}`, product);
    case 'speak':
      return logEvent(`团队·${ev.member}`, 'info', ev.text, product);
    case 'image_call':
      return logEvent('团队·出图', 'info', `${ev.member} 发起第 ${ev.seq} 张:${ev.prompt}`, product);
    case 'image_ok':
      return logEvent('团队·出图', 'info', `第 ${ev.seq} 张成功`, product, [serve(ev.path)]);
    case 'image_fail':
      return logEvent('团队·出图', 'error', `第 ${ev.seq} 张失败:${ev.error}`, product);
    case 'quota_denied':
      return logEvent('团队·出图', 'warn', `出图配额用满(${ev.used}/${ev.cap}),队长应停手交差`, product);
    case 'done':
      return logEvent(
        '团队·结束',
        ev.subtype === 'success' ? 'info' : 'error',
        `会话终态 ${ev.subtype} · ${ev.turns} 轮${ev.errors.length ? ` · 错误:${ev.errors.join(' / ')}` : ''}`,
        product,
      );
  }
}

function fail(error: string): RunTeamRemixResult {
  return { ok: false, created: 0, failed: 0, error };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
