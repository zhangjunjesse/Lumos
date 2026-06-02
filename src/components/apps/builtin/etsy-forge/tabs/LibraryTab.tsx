'use client';

// 图库 tab —— 商品维度展示（一行一商品，按入库倒序）。选择模式可批量打标签/删除/抠图/分析素材/抠姿势，点图弹大图。
// 批量动作逻辑集中在 useLibraryActions hook。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type LibProduct } from '../api-client';
import { LibraryProductRow } from './LibraryProductRow';
import { LibraryBatchBar } from './LibraryBatchBar';
import { LibraryTagFilter } from './LibraryTagFilter';
import { ImageLightbox } from './ImageLightbox';
import { ReviewModal } from './ReviewModal';
import { CutoutModal } from './CutoutModal';
import { useLibraryActions } from './use-library-actions';

export function LibraryTab() {
  const [products, setProducts] = useState<LibProduct[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ productId: string; index: number } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ productId: string; title: string } | null>(null);
  const [cutoutTarget, setCutoutTarget] = useState<{ productId: string; title: string } | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selProducts, setSelProducts] = useState<Set<string>>(new Set());
  const [selImages, setSelImages] = useState<Set<string>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await etsyForgeApi.listLibrary();
      setProducts(res.products);
      setAllTags(res.allTags);
      setTotal(res.total);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 有商品在「素材分析」或「抠姿势」中就每 5s 自动刷新，看后台进度；全跑完自动停。
  useEffect(() => {
    if (!products.some((p) => p.asset_status === 'running' || p.pose_status === 'running')) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [products, load]);

  const clearSelection = useCallback(() => {
    setSelProducts(new Set());
    setSelImages(new Set());
  }, []);
  const exitSelect = () => {
    setSelectMode(false);
    clearSelection();
  };
  const toggleIn = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  const actions = useLibraryActions({ products, selProducts, selImages, setProducts, clearSelection, reload: load });

  const visibleProducts = useMemo(
    () => (activeTags.size === 0 ? products : products.filter((p) => p.tags.some((t) => activeTags.has(t)))),
    [products, activeTags],
  );
  const lightboxProduct = useMemo(
    () => (lightbox ? (products.find((p) => p.product_id === lightbox.productId) ?? null) : null),
    [lightbox, products],
  );
  const error = actions.error ?? loadError;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {products.length} 个商品 · {total} 张详情图 · 按入库时间倒序
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant={selectMode ? 'default' : 'outline'}
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          disabled={products.length === 0}
        >
          {selectMode ? '退出选择' : '选择'}
        </Button>
      </div>

      <LibraryTagFilter
        allTags={allTags}
        activeTags={activeTags}
        onToggle={(t) => setActiveTags((s) => toggleIn(s, t))}
        onClear={() => setActiveTags(new Set())}
      />

      {selectMode && (
        <LibraryBatchBar
          selectedProductCount={selProducts.size}
          selectedImageCount={selImages.size}
          allTags={allTags}
          busy={actions.busy}
          onAddTag={actions.addTag}
          onRemoveTag={actions.removeTag}
          onCutout={actions.cutoutSelected}
          onPipeline={actions.runPipeline}
          onRemix={actions.remixSelected}
          onDelete={actions.deleteSelected}
          onClear={exitSelect}
        />
      )}

      {actions.msg && <p className="mb-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">{actions.msg}</p>}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!loading && products.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          图库还是空的。去「已采集商品」勾选商品，点「爬选中详情图」把详情图采进来。
        </div>
      )}
      {!loading && products.length > 0 && visibleProducts.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          没有带所选标签的商品，换个标签或清除筛选。
        </div>
      )}

      {!loading && visibleProducts.length > 0 && (
        <div className="space-y-3">
          {visibleProducts.map((p) => (
            <LibraryProductRow
              key={p.product_id}
              product={p}
              selectMode={selectMode}
              productSelected={selProducts.has(p.product_id)}
              onToggleProduct={() => setSelProducts((s) => toggleIn(s, p.product_id))}
              selectedImageIds={selImages}
              onToggleImage={(id) => setSelImages((s) => toggleIn(s, id))}
              onOpenImage={(index) => setLightbox({ productId: p.product_id, index })}
              onViewReviews={() => setReviewTarget({ productId: p.product_id, title: p.title })}
              onViewCutouts={() => setCutoutTarget({ productId: p.product_id, title: p.title })}
              onClassify={() => actions.classifyProduct(p.product_id)}
              onSetImageType={actions.setImageType}
            />
          ))}
        </div>
      )}

      {lightboxProduct && lightbox && (
        <ImageLightbox
          images={lightboxProduct.images.map((i) => ({ url: i.url, title: lightboxProduct.title }))}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox({ productId: lightbox.productId, index })}
          onClose={() => setLightbox(null)}
        />
      )}

      {reviewTarget && (
        <ReviewModal productId={reviewTarget.productId} title={reviewTarget.title} onClose={() => setReviewTarget(null)} />
      )}

      {cutoutTarget && (
        <CutoutModal productId={cutoutTarget.productId} title={cutoutTarget.title} onClose={() => setCutoutTarget(null)} />
      )}
    </div>
  );
}
