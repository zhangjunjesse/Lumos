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
import { FissionPanel } from './FissionPanel';

const SECTIONS: { key: AssetItem['category']; label: string; hint: string }[] = [
  { key: 'design', label: '印花', hint: '从 T 恤抠出的印花图案（融合主角）' },
  { key: 'scene', label: '场景图', hint: '环境背景（花园/海边…）' },
  { key: 'model', label: '模特图', hint: '模特人物（空白 T）' },
  { key: 'product', label: '产品图', hint: '空白载体（光板 T 恤…）' },
  { key: 'pose', label: '模特姿势', hint: '从原图抠的真实模特' },
  { key: 'remix', label: '二创印花', hint: '基于原印花 + 标题/卖点生成的变体（SOP⑤）' },
];

export function AssetsTab() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [products, setProducts] = useState<LibProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'type' | 'source'>('source');
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [origView, setOrigView] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [retryPoll, setRetryPoll] = useState(0);
  const [fission, setFission] = useState<{ productId: string; baseRef: string; baseTitle: string | null; baseAssetId: string } | null>(null);
  const [fissioningIds, setFissioningIds] = useState<Set<string>>(new Set()); // 正在裂变的母版图 id(显示「裂变中」)

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

  // 每 6s 轮询裂变活跃运行 → 哪些母版图正在「裂变中」;运行变少(有跑完)就刷新素材,让新图冒出来。
  useEffect(() => {
    const tick = async () => {
      try {
        const { runs } = await etsyForgeApi.listFissionRuns();
        const next = new Set(runs.map((r) => r.base_asset_id).filter(Boolean));
        setFissioningIds((prev) => {
          if (prev.size > 0 && next.size < prev.size) void load(); // 有运行结束 → 刷新
          return next;
        });
      } catch {
        /* 轮询抖动忽略 */
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 6000);
    return () => clearInterval(t);
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm('删除这张素材？')) return;
    try {
      await etsyForgeApi.deleteAsset(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 重试后台单跑(最长 10min)，开轮询看结果冒出来，全完自动停。
  useEffect(() => {
    if (!retryPoll) return;
    const t = setInterval(() => void load(), 8000);
    const stop = setTimeout(() => {
      clearInterval(t);
      setRetryPoll(0);
      setMsg(null);
    }, 10 * 60 * 1000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [retryPoll, load]);

  // 单张失败素材重试：后台单跑(不和别的生成并发)，请求秒返回，轮询刷新看结果。
  const retry = async (id: string) => {
    setError(null);
    try {
      await etsyForgeApi.retryAsset(id);
      setMsg('重试中，后台生成（最长 10 分钟），结果会自动刷新…');
      setRetryPoll(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Step11 系列化：以一张达标二创印花为母版，后台扩展 5-10 张同系列新印花，轮询刷新看结果。
  const series = async (a: AssetItem) => {
    if (!a.source_product_id) return;
    if (!confirm(`以这张达标印花为母版，扩展一组同系列新印花（固定风格/配色/受众，变主体/身份/节日/道具/文案/场景）？后台跑。`)) return;
    setError(null);
    try {
      await etsyForgeApi.remixSeries(a.source_product_id, a.id);
      setMsg('系列化中，后台生成（最长 10 分钟），结果会自动刷新…');
      setRetryPoll(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 二创：基于这张印花对它所属商品出变体（默认方向 B），后台跑、轮询刷新看结果。
  const remix = async (a: AssetItem) => {
    if (!a.source_product_id) return;
    if (!confirm('基于这张印花二创，给它所属商品出一组变体印花？后台跑。')) return;
    setError(null);
    try {
      await etsyForgeApi.remixProduct(a.source_product_id);
      setMsg('二创中，后台生成（最长 10 分钟），结果会自动刷新…');
      setRetryPoll(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 裂变：打开方向库精修工作台（诊断→选方向→对比→定稿→迭代）。母版=这张图,目标产品=它所属商品。
  const openFission = (a: AssetItem) => {
    if (!a.source_product_id || !a.url) return;
    setFission({ productId: a.source_product_id, baseRef: a.url, baseTitle: a.source_product_title, baseAssetId: a.id });
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
      {msg && <p className="mb-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">{msg}</p>}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!loading && view === 'source' && (
        <AssetsBySource products={products} assets={assets} onView={setLightboxId} onViewOrig={setOrigView} onRemove={remove} onRetry={retry} onSeries={series} onRemix={remix} onFission={openFission} fissioningIds={fissioningIds} />
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
                    <AssetCard key={a.id} asset={a} onView={setLightboxId} onViewOrig={setOrigView} onRemove={remove} onRetry={retry} onSeries={series} onRemix={remix} onFission={openFission} fissioning={fissioningIds.has(a.id)} />
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
      {fission && (
        <FissionPanel
          productId={fission.productId}
          baseRef={fission.baseRef}
          baseAssetId={fission.baseAssetId}
          baseTitle={fission.baseTitle}
          onZoom={setOrigView}
          onClose={() => {
            setFission(null);
            void load(); // 裂变出图都落进 remix 素材,关闭时刷新一下
          }}
        />
      )}
    </div>
  );
}
