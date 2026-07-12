// SOP 单步执行:把每个 step key 映射到已有底层模块,统一成「成功返回摘要 / 失败 throw(原因)」。
// 不 mock:每步如实调真实模块,失败抛真实原因。⑥ 用 ④ 的产品(空白T) + ⑤ 的二创印花做产品图。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { runDetailCollect } from '../detail-collect';
import { runShopCollect } from '../shop-collect';
import { analyzeProductReviews } from '../review-analysis';
import { classifyImages } from '../classify-image';
import { runCutout } from '../cutout-collect';
import { runAnalyzeAssets } from '../asset-analyze';
import { runPoseExtract } from '../pose-extract';
import { runTeamRemix } from '../team/run-team';
import { stripBackground } from '@/lib/image/compose';
import { composeMockupRecord } from '../mockup-compose';
import { listEnabledTemplates } from '../mockup-templates';
import { getBrowserContextId, BROWSER_STEP_LOCK } from '../store';
import { withLock } from '@/lib/async-lock';
import type { SopStepCtx } from './engine';
import { COLLECTIONS, type AssetRow, type DetailImageRow, type ImageType, type ProductRow, type SopStepKey } from '../types';

// 采集详情/店铺串行锁(BROWSER_STEP_LOCK,定义在 ../store):并发跑链时这些步驱动同一个 AdsPower/CDP 连接、
// 跑完会 browser.close(),并发会互相把连接关掉 → 全失败。这些步全局串行,后续图片步仍并发。

// 按 ②b 分类挑图:取指定 type 的图,并**按 types 的顺序优先**(靠前的 type 优先选)。
// 该商品还没分类(都没 type)就退回全部图(降级不阻断)。max 限制张数(③抠印花只需 2~3 张参考)。
function pickImageIds(store: AppDataStore, productId: string, types: ImageType[], max?: number): string[] | undefined {
  const imgs = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { product_id: productId }, limit: 1000 });
  const rank = (t?: ImageType) => (t && types.includes(t) ? types.indexOf(t) : 999);
  const matched = imgs.filter((i) => i.image_type && types.includes(i.image_type)).sort((a, b) => rank(a.image_type) - rank(b.image_type));
  const pool = matched.length > 0 ? matched : imgs; // 没分类则用全部
  if (pool.length === 0) return undefined; // 没图 → 不传,让底层模块自行报「没有详情图」
  const ids = pool.map((i) => i.id);
  return max ? ids.slice(0, max) : ids;
}

// ③ 抠印花:**优先平铺产品图(product)**,其次商品图(model_scene);平铺图抠出的印花最干净(模特图有褶皱透视)。挑 ≤3 张。
async function execCutout(store: AppDataStore, userId: string, productId: string): Promise<string> {
  const imageIds = pickImageIds(store, productId, ['product', 'model_scene'], 3);
  const r = await runCutout(store, { userId, productIds: [productId], imageIds });
  if (r.error) throw new Error(r.error);
  if (r.okProducts === 0) throw new Error('抠印花失败(看日志)');
  return '抠出 1 个印花';
}

// ④ 分析素材 + 抠姿势:产品图已改用固定T恤模板程序合成,这一步不再服务主链,默认停用省 3~6 次
// 图片调用;「设置」里 assets_step_enabled=true 可重新打开(场景/模特/姿势素材进图库备用)。
async function execAssets(store: AppDataStore, userId: string, productId: string): Promise<string> {
  const settings = store.query<{ max_pose?: number; assets_step_enabled?: boolean }>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
  if (settings?.assets_step_enabled !== true) {
    return '已停用(产品图改用固定模板,不再需要;设置里可重新开启)';
  }
  const sceneIds = pickImageIds(store, productId, ['model_scene']); // 分析素材用全部商品图作参考(只出 3 张)
  const maxPose = Math.max(1, Math.min(20, Math.floor(settings?.max_pose ?? 3)));
  const poseIds = pickImageIds(store, productId, ['model_scene'], maxPose); // 抠姿势限前 N 张
  const [a, pose] = await Promise.all([
    runAnalyzeAssets(store, { userId, productId, imageIds: sceneIds }),
    runPoseExtract(store, { userId, productId, imageIds: poseIds }),
  ]);
  if (!a.ok && !pose.ok) throw new Error(a.error || pose.error || '素材/姿势全部失败');
  return `素材 ${a.created} / 姿势 ${pose.created}`;
}

// ① 采集详情:已采过(detail_status=success 且有图)就跳过,否则爬(全局串行,避免并发抢/关浏览器)。
async function execDetail(store: AppDataStore, userId: string, productId: string): Promise<string> {
  const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId);
  if (p?.detail_status === 'success' && (p.detail_image_count ?? 0) > 0) return '已有详情，跳过';
  const r = await withLock(BROWSER_STEP_LOCK, () =>
    runDetailCollect(store, { userId, productIds: [productId], browserContextId: getBrowserContextId(store) }),
  );
  if (r.error) throw new Error(r.error);
  if (r.okProducts === 0) throw new Error('详情采集失败(没爬到图，可能 AdsPower/CDP 不可用)');
  return `详情图 ${r.totalImages} 张`;
}

// ⑥ 出产品图:⑤的二创印花 × 启用的T恤模板,sharp 程序合成(白底转透明+贴印花区),零 LLM 零 token。
// 旧的 inpaint 合成(product-merge)只保留给「我的产品」页的手动重合成入口。
async function execMockup(store: AppDataStore, userId: string, productId: string): Promise<string> {
  const remixes = store.query<AssetRow>(COLLECTIONS.ASSETS, {
    filter: { user_id: userId, product_id: productId, category: 'remix', status: 'success' },
    limit: 50,
  });
  if (remixes.length === 0) throw new Error('没有二创印花(⑤未产出)');
  const templates = listEnabledTemplates(store, userId);
  if (templates.length === 0) throw new Error('没有启用的T恤模板(去「出图团队」页的模板区启用/上传一个)');

  let ok = 0;
  const total = remixes.length * templates.length;
  for (const rm of remixes) {
    if (!rm.image_path) continue;
    let print: Buffer;
    try {
      print = await stripBackground(rm.image_path); // 每张印花只预处理一次(抠外围底色),贴到所有模板
    } catch (err) {
      for (const tpl of templates) {
        store.create(COLLECTIONS.MOCKUPS, {
          user_id: userId,
          design_label: '二创',
          design_ref: rm.image_path,
          source_product_id: productId,
          template_id: tpl.id,
          status: 'failed',
          failure_reason: `印花预处理失败:${err instanceof Error ? err.message : String(err)}`,
          created_at: new Date().toISOString(),
        });
      }
      continue;
    }
    for (const tpl of templates) {
      const success = await composeMockupRecord(store, userId, {
        print,
        template: tpl,
        designRef: rm.image_path,
        sourceProductId: productId,
      });
      if (success) ok += 1;
    }
  }
  if (ok === 0) throw new Error('产品图全部失败(看日志)');
  return `产品图 ${ok}/${total}(模板合成,零token)`;
}

export async function execStep(store: AppDataStore, userId: string, productId: string, key: SopStepKey, ctx?: SopStepCtx): Promise<string> {
  switch (key) {
    case 'detail':
      return execDetail(store, userId, productId);
    case 'shop':
      // 采店铺也驱动浏览器(AdsPower/CDP),复用详情串行锁避免并发抢/关连接。可选步:失败由 engine 记录但不断链。
      return withLock(BROWSER_STEP_LOCK, () => runShopCollect(store, userId, productId));
    case 'review': {
      // 没评论不算失败:软跳过让链继续(二创不强依赖评论卖点)。有评论才分析。
      const hasReview = store.query(COLLECTIONS.REVIEWS, { filter: { product_id: productId }, limit: 1 }).length > 0;
      if (!hasReview) return '无评论，跳过分析';
      const a = await analyzeProductReviews(store, userId, productId);
      return `分析了 ${a.reviewsAnalyzed} 条评论`;
    }
    case 'classify': {
      const r = await classifyImages(store, { userId, productId });
      if (!r.ok) throw new Error(r.error || '分类失败');
      return `分类 ${r.classified} 张${r.failed ? `、${r.failed} 失败` : ''}`;
    }
    case 'cutout':
      return execCutout(store, userId, productId);
    case 'assets':
      return execAssets(store, userId, productId);
    case 'remix': {
      // 一键出品选的出图团队随 ctx 下传;空 → 默认团队。方向矩阵轮转在一键链里退役
      // (手动单商品二创入口仍走 runRemix,见 /api/apps/builtin/etsy-forge/remix)。
      const r = await runTeamRemix(store, { userId, productId, teamId: ctx?.teamId });
      if (!r.ok) throw new Error(r.error || '团队出图失败');
      return `团队出图 ${r.created} 张`;
    }
    case 'mockup':
      return execMockup(store, userId, productId);
    default:
      throw new Error(`未知步骤: ${key}`);
  }
}
