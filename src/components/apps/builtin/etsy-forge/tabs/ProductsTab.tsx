'use client';

// 商品列表 tab —— 第一步采集结果。商品卡（主图 + EHunt 指标）+ 勾选 + 「爬选中详情图」入图库。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type Product } from '../api-client';

const DETAIL_LABEL: Record<string, string> = {
  idle: '',
  running: '爬取中',
  success: '已采集',
  failed: '失败',
};

export function ProductsTab({ onCollectedDetails }: { onCollectedDetails?: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await etsyForgeApi.listProducts();
      setProducts(res.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedIds = products.filter((p) => p.selected).map((p) => p.id);

  const toggle = async (p: Product) => {
    setProducts((arr) => arr.map((x) => (x.id === p.id ? { ...x, selected: !x.selected } : x)));
    try {
      await etsyForgeApi.setSelected([p.id], !p.selected);
    } catch {
      void load();
    }
  };

  const selectAll = async (selected: boolean) => {
    const ids = products.map((p) => p.id);
    setProducts((arr) => arr.map((x) => ({ ...x, selected })));
    try {
      await etsyForgeApi.setSelected(ids, selected);
    } catch {
      void load();
    }
  };

  const collectDetails = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`爬 ${selectedIds.length} 个选中商品的详情页所有详情图？走浏览器，约每个 5-10 秒。`)) return;
    setCollecting(true);
    setMsg(null);
    setError(null);
    try {
      const r = await etsyForgeApi.collectDetails(selectedIds);
      setMsg(`完成：${r.okProducts} 个商品成功、${r.failProducts} 个失败，共采集 ${r.totalImages} 张详情图入图库。`);
      await load();
      onCollectedDetails?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {products.length} 个商品 · 已选 {selectedIds.length}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void selectAll(true)} disabled={products.length === 0}>
          全选
        </Button>
        <Button size="sm" variant="outline" onClick={() => void selectAll(false)} disabled={selectedIds.length === 0}>
          清空选择
        </Button>
        <Button size="sm" onClick={() => void collectDetails()} disabled={collecting || selectedIds.length === 0}>
          {collecting ? '爬详情图中…' : `爬选中 ${selectedIds.length} 个的详情图`}
        </Button>
      </div>

      {msg && <p className="mb-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">{msg}</p>}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!loading && products.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          还没有商品。去「采集任务」建关键词任务并「立即爬」。
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {products.map((p) => (
            <div
              key={p.id}
              className={`overflow-hidden rounded-md border ${p.selected ? 'border-foreground ring-1 ring-foreground' : 'border-border'}`}
            >
              <button type="button" onClick={() => void toggle(p)} className="block w-full">
                <div className="relative aspect-square bg-muted">
                  {p.main_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.main_image_url} alt={p.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">无主图</div>
                  )}
                  {p.selected && (
                    <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded bg-foreground text-xs text-background">
                      ✓
                    </span>
                  )}
                  {p.detail_status !== 'idle' && (
                    <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      {DETAIL_LABEL[p.detail_status]}
                      {p.detail_status === 'success' ? ` ${p.detail_image_count}` : ''}
                    </span>
                  )}
                </div>
              </button>
              <div className="p-2">
                <p className="line-clamp-2 text-xs text-foreground">{p.title || '(无标题)'}</p>
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{p.price ?? ''}</span>
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    看原页
                  </a>
                </div>
                {p.ehunt ? (
                  <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                    销量 {p.ehunt.salesTotal ?? '?'}
                    {p.ehunt.salesRecent != null ? `(${p.ehunt.salesRecent})` : ''} · 收藏 {p.ehunt.favorites ?? '?'}
                    {p.ehunt.listedDate ? ` · ${p.ehunt.listedDate}` : ''}
                  </p>
                ) : (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {p.ehunt_status === 'not_adspower' ? '无 EHunt(非 AdsPower)' : '无 EHunt'}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
