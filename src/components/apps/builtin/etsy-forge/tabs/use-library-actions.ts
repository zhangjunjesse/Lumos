'use client';

// 图库批量动作集中处：标签 / 一键处理 / 删除。
// 一键处理：勾选的步骤(抠印花/分析素材/抠姿势任意组合)一起发起，都走图片服务商、后台跑、不阻塞 UI。
// 抠印花用「提示词管理→抠印花」的生效那条(不弹确认框，要调 prompt 去提示词管理改生效)。
// 点了立即返回 + 乐观标状态，进度看商品行；接口回来后整体刷新拿真实结果。

import { useState, type Dispatch, type SetStateAction } from 'react';
import { etsyForgeApi, type ImageType, type LibProduct } from '../api-client';

export interface PipelineSteps {
  analyze: boolean;
  pose: boolean;
}

interface Args {
  products: LibProduct[];
  selProducts: Set<string>;
  selImages: Set<string>;
  setProducts: Dispatch<SetStateAction<LibProduct[]>>;
  clearSelection: () => void;
  reload: () => Promise<void>;
}

export function useLibraryActions({ products, selProducts, selImages, setProducts, clearSelection, reload }: Args) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runOp = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(`⏳ ${label}`);
    setError(null);
    try {
      setMsg(await fn());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const resolveSelection = (): { productIds: string[]; imageIds?: string[] } | null => {
    const imageIds = selImages.size > 0 ? [...selImages] : undefined;
    const productIds =
      selProducts.size > 0
        ? [...selProducts]
        : [...new Set(products.filter((p) => p.images.some((i) => selImages.has(i.id))).map((p) => p.product_id))];
    return productIds.length ? { productIds, imageIds } : null;
  };

  const addTag = (tag: string) =>
    void runOp('加标签中…', async () => {
      const r = await etsyForgeApi.applyProductTags([...selProducts], { add: [tag] });
      return `已给 ${r.updated} 个商品加标签「${tag}」`;
    });
  const removeTag = (tag: string) =>
    void runOp('去标签中…', async () => {
      const r = await etsyForgeApi.applyProductTags([...selProducts], { remove: [tag] });
      return `已从 ${r.updated} 个商品去掉标签「${tag}」`;
    });

  // 抠印花：独立动作。一个商品的多张图合起来出 1 张印花，选图粒度和「生成素材」不同，所以单独拎出来。
  // 用「提示词管理→抠印花」生效那条，后台跑、不阻塞。
  const cutoutSelected = () => {
    const sel = resolveSelection();
    if (!sel) return;
    const { productIds, imageIds } = sel;
    const scope = imageIds ? `用选中的 ${imageIds.length} 张图` : '用商品全部图';
    if (!confirm(`对 ${productIds.length} 个商品抠印花（${scope}，每个商品所有图合起来出 1 张）？用「提示词管理→抠印花」生效那条，后台跑。`)) return;
    setProducts((arr) => arr.map((p) => (productIds.includes(p.product_id) ? { ...p, cutout_status: 'running' } : p)));
    clearSelection();
    setError(null);
    setMsg(`已发起抠印花（${productIds.length} 个商品，后台跑）。完成后看商品行「查看抠图」。`);
    void etsyForgeApi
      .startCutout({ productIds, imageIds })
      .then(() => void reload())
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  // 生成素材：分析素材 / 抠姿势(逐张) 可勾选组合，一起后台发起。
  const runPipeline = (steps: PipelineSteps) => {
    const sel = resolveSelection();
    if (!sel) return;
    const { productIds, imageIds } = sel;
    const labels = [steps.analyze && '分析素材', steps.pose && '抠姿势'].filter(Boolean) as string[];
    if (labels.length === 0) return;
    const scope = imageIds ? `用选中的 ${imageIds.length} 张图` : '用商品全部图';
    if (!confirm(`对 ${productIds.length} 个商品生成素材：${labels.join(' + ')}（${scope}）？后台跑，进度看商品行。`)) return;
    setProducts((arr) =>
      arr.map((p) =>
        productIds.includes(p.product_id)
          ? {
              ...p,
              ...(steps.analyze ? { asset_status: 'running' } : {}),
              ...(steps.pose ? { pose_status: 'running' } : {}),
            }
          : p,
      ),
    );
    clearSelection();
    setError(null);
    setMsg(`已发起：${labels.join(' + ')}（后台跑）。完成后去「我的图库」看。`);
    const tasks: Promise<unknown>[] = [];
    if (steps.analyze) tasks.push(etsyForgeApi.analyzeAssets(productIds, imageIds));
    if (steps.pose) tasks.push(etsyForgeApi.extractPose(productIds, imageIds));
    void Promise.allSettled(tasks).then(() => void reload());
  };

  // ⑤ 二创：对勾选商品逐个发起二创(基于抠出的印花 + 标题/卖点出 5 个变体)。需先抠印花。后台跑，不阻塞。
  const remixSelected = () => {
    const productIds = [...selProducts];
    if (!productIds.length) return;
    if (!confirm(`对 ${productIds.length} 个商品二创（每个基于抠出的印花 + 标题/卖点出 5 个变体印花）？需先抠印花，没印花的会失败(看日志)。后台跑。`)) return;
    clearSelection();
    setError(null);
    setMsg(`已发起二创（${productIds.length} 个商品，后台跑）。完成去「我的图库 → 二创印花」看。`);
    void Promise.allSettled(productIds.map((id) => etsyForgeApi.remixProduct(id))).then(() => void reload());
  };

  // ②b 详情图分类:对该商品详情图 AI 分类(走 vision,逐图有限并发)。
  const classifyProduct = (productId: string) =>
    void runOp('分类详情图中（走 vision，稍候）…', async () => {
      const r = await etsyForgeApi.classifyImages(productId);
      return `分类完成:${r.classified} 张成功${r.failed ? `、${r.failed} 张失败` : ''}`;
    });
  // 人工纠正单张图类型
  const setImageType = (imageId: string, imageType: ImageType) =>
    void runOp('更新图类型…', async () => {
      await etsyForgeApi.setImageType(imageId, imageType);
      return '已更新图类型';
    });

  const deleteSelected = () => {
    const np = selProducts.size;
    const ni = selImages.size;
    if (np === 0 && ni === 0) return;
    if (!confirm(`确认删除选中的 ${np} 个商品（连带其所有详情图）+ ${ni} 张单独选中的图？不可恢复。`)) return;
    void runOp('删除中…', async () => {
      const r = await etsyForgeApi.deleteLibrary({ productIds: [...selProducts], imageIds: [...selImages] });
      clearSelection();
      return `已删除 ${r.deletedProducts} 个商品、${r.deletedImages} 张详情图`;
    });
  };

  return { busy, msg, error, addTag, removeTag, cutoutSelected, runPipeline, remixSelected, classifyProduct, setImageType, deleteSelected };
}
