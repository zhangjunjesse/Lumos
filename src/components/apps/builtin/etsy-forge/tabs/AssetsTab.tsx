'use client';

// 我的图库 tab —— 素材库（印花/场景/模特/产品/模特姿势）。两种视图：
//   「按类型」：场景/模特/产品 三区平铺。
//   「按来源」：每个分析过的商品一组（原图 → 它生成的三类 + 进度状态，看得到哪些在生成/已完成）。
// 点素材/原图放大查看。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type AssetItem, type LibProduct } from '../api-client';
import { AssetCard } from './AssetCard';
import { AssetsBySource } from './AssetsBySource';
import { ImageLightbox } from './ImageLightbox';

const SECTIONS: { key: AssetItem['category']; label: string; hint: string }[] = [
  { key: 'design', label: '印花', hint: '从 T 恤抠出的印花图案（融合主角）' },
  { key: 'scene', label: '场景图', hint: '环境背景（花园/海边…）' },
  { key: 'model', label: '模特图', hint: '模特人物（空白 T）' },
  { key: 'product', label: '产品图', hint: '空白载体（光板 T 恤…）' },
  { key: 'pose', label: '模特姿势', hint: '从原图抠的真实模特' },
];

export function AssetsTab() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [products, setProducts] = useState<LibProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'type' | 'source'>('source');
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [origView, setOrigView] = useState<string | null>(null);

  const viewable = assets.filter((a) => a.status === 'success' && a.url);
  const lightboxIndex = lightboxId ? viewable.findIndex((a) => a.id === lightboxId) : -1;
  const analyzing = products.filter((p) => p.asset_status === 'running' || p.pose_status === 'running').length;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [a, lib] = await Promise.all([etsyForgeApi.listAssets(), etsyForgeApi.listLibrary()]);
      setAssets(a.assets);
      setProducts(lib.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 有商品在分析中就每 6s 自动刷新（看进度/新素材冒出），全完自动停。
  useEffect(() => {
    if (analyzing === 0) return;
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [analyzing, load]);

  const remove = async (id: string) => {
    if (!confirm('删除这张素材？')) return;
    try {
      await etsyForgeApi.deleteAsset(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const tabBtn = (v: 'type' | 'source', label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      className={`rounded-md px-2.5 py-1 text-xs ${view === v ? 'bg-foreground text-background' : 'border text-muted-foreground'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabBtn('source', '按来源')}
        {tabBtn('type', '按类型')}
        <span className="text-xs text-muted-foreground">
          共 {assets.length} 张{analyzing > 0 ? ` · ${analyzing} 个商品处理中…` : ''}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void load()}>
          刷新
        </Button>
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!loading && view === 'source' && (
        <AssetsBySource products={products} assets={assets} onView={setLightboxId} onViewOrig={setOrigView} onRemove={remove} />
      )}

      {!loading &&
        view === 'type' &&
        SECTIONS.map((sec) => {
          const items = assets.filter((a) => a.category === sec.key);
          return (
            <section key={sec.key} className="mb-6">
              <h3 className="mb-2 text-sm font-medium">
                {sec.label}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {sec.hint} · {items.length} 张
                </span>
              </h3>
              {items.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">还没有</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
                  {items.map((a) => (
                    <AssetCard key={a.id} asset={a} onView={setLightboxId} onViewOrig={setOrigView} onRemove={remove} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

      {lightboxIndex >= 0 && (
        <ImageLightbox
          images={viewable.map((a) => ({ url: a.url as string, title: a.source_product_title ?? '' }))}
          index={lightboxIndex}
          onIndexChange={(i) => setLightboxId(viewable[i]?.id ?? null)}
          onClose={() => setLightboxId(null)}
        />
      )}
      {origView && (
        <ImageLightbox images={[{ url: origView, title: '来源原图' }]} index={0} onIndexChange={() => {}} onClose={() => setOrigView(null)} />
      )}
    </div>
  );
}
