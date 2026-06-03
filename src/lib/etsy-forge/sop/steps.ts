// SOP 单步执行:把每个 step key 映射到已有底层模块,统一成「成功返回摘要 / 失败 throw(原因)」。
// 不 mock:每步如实调真实模块,失败抛真实原因。⑥ 用 ④ 的产品(空白T) + ⑤ 的二创印花做产品图。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { runDetailCollect } from '../detail-collect';
import { analyzeProductReviews } from '../review-analysis';
import { classifyImages } from '../classify-image';
import { runCutout } from '../cutout-collect';
import { runAnalyzeAssets } from '../asset-analyze';
import { runPoseExtract } from '../pose-extract';
import { runRemix } from '../remix';
import { prepareMerge, mergeOneProduct } from '../product-merge';
import { getBrowserContextId } from '../store';
import { getImageConcurrency, mapLimit } from '../concurrency';
import { withLock } from '@/lib/async-lock';
import type { SopStepCtx } from './engine';
import { COLLECTIONS, type AssetRow, type DetailImageRow, type ImageType, type ProductRow, type SopStepKey } from '../types';

const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;
// ①采集详情串行锁:多商品并发跑链时,详情采集要驱动同一个浏览器(AdsPower/CDP)、且跑完会 browser.close(),
// 并发会互相把连接关掉 → 全失败。这一步全局串行(同一时刻只一个商品碰浏览器),后续图片步仍并发。
const BROWSER_STEP_LOCK = 'etsy-forge:detail-browser';

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

// ④ 分析素材 + 抠姿势:只用「商品图」类(带模特/场景的图);没有则降级全部。
// 场景/模特/产品各出 1 张(固定);抠姿势是逐图的,按设置 max_pose 上限取前 N 张,避免图多的商品狂出姿势烧钱。
async function execAssets(store: AppDataStore, userId: string, productId: string): Promise<string> {
  const sceneIds = pickImageIds(store, productId, ['model_scene']); // 分析素材用全部商品图作参考(只出 3 张)
  const settings = store.query<{ max_pose?: number }>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
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

// ⑥ 出产品图:⑤的二创印花(remix) 逐个 inpaint 到 ④的产品(空白T) → mockup。
async function execMockup(store: AppDataStore, userId: string, productId: string): Promise<string> {
  const remixes = store.query<AssetRow>(COLLECTIONS.ASSETS, {
    filter: { user_id: userId, product_id: productId, category: 'remix', status: 'success' },
    limit: 50,
  });
  if (remixes.length === 0) throw new Error('没有二创印花(⑤未产出)');
  const productAsset = store.query<AssetRow>(COLLECTIONS.ASSETS, {
    filter: { user_id: userId, product_id: productId, category: 'product', status: 'success' },
    limit: 10,
  })[0];
  if (!productAsset?.image_path) throw new Error('没有产品图(空白T)(④未产出),无法合成');

  const outcomes = await mapLimit(remixes, getImageConcurrency(store), async (rm) => {
    if (!rm.image_path) return false;
    const design = { localPath: rm.image_path, url: serve(rm.image_path), label: '二创', sourceProductId: productId };
    const prep = await prepareMerge(store, userId, design);
    if ('error' in prep) {
      store.create(COLLECTIONS.MOCKUPS, {
        user_id: userId,
        design_label: '二创',
        design_ref: rm.image_path,
        source_product_id: productId,
        product_asset_id: productAsset.id,
        status: 'failed',
        failure_reason: prep.error,
        created_at: new Date().toISOString(),
      });
      return false;
    }
    return mergeOneProduct(store, userId, design, prep, productAsset.id);
  });
  const ok = outcomes.filter(Boolean).length;
  if (ok === 0) throw new Error('产品图全部失败(看日志)');
  return `产品图 ${ok}/${remixes.length}`;
}

export async function execStep(store: AppDataStore, userId: string, productId: string, key: SopStepKey, ctx?: SopStepCtx): Promise<string> {
  switch (key) {
    case 'detail':
      return execDetail(store, userId, productId);
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
      // 一键出品选的方向矩阵(可多选)随 ctx 下传;空 → runRemix 兜底默认 B。
      const r = await runRemix(store, { userId, productId, directions: ctx?.directions });
      if (!r.ok) throw new Error(r.error || `二创全部失败(${r.failed} 个)`);
      return `二创 ${r.created} 个`;
    }
    case 'mockup':
      return execMockup(store, userId, productId);
    default:
      throw new Error(`未知步骤: ${key}`);
  }
}
