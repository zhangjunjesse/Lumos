'use client';

// 「我的产品」—— 每个产品一行(采集商品 或 手攒产品)。行内 MidJourney 式内联生成:选参考图(可跨产品/图库) + 提示词 → 生成,挂到本行。
// 「＋增加产品」建一个手攒产品占位行(无 Etsy 来源),同一个生成条。结果异步生成,前端轮询。无弹框。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type AssetItem, type ManualProduct, type MockupItem } from '../api-client';
import { ImageLightbox } from './ImageLightbox';
import { ProductImageCard, ProductCardSkeleton } from './ProductImageCard';
import { ProductMockupModal } from './ProductMockupModal';
import { ProductComposer, type RefImage } from './ProductComposer';
import { DirectionShotButton, type DirectionSource } from './DirectionShotButton';
import { useMockupRetry } from './use-mockup-retry';
import { SrcThumb } from './SrcThumb';

const THUMB_SIZES = [80, 112, 144, 180]; // 产品图缩略尺寸档位(px)
const CAT_LABEL: Record<string, string> = { design: '印花', remix: '二创', scene: '场景', model: '模特', product: '产品图', pose: '姿势' };

interface Group {
  key: string;
  productId: string | null; // 生成目标(采集 id / 手攒 id);老数据可能为 null
  isManual: boolean;
  productImage: string | null;
  productTitle: string | null;
  productUrl: string | null;
  createdAt: string; // 排序用:手攒=创建时间,采集=最新产品图时间(不再置顶手攒)
  items: MockupItem[];
}

export function ProductTab() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [mockups, setMockups] = useState<MockupItem[]>([]);
  const [manualProducts, setManualProducts] = useState<ManualProduct[]>([]);
  const [pending, setPending] = useState(0);
  const [pendingByProduct, setPendingByProduct] = useState<Record<string, number>>({}); // 每个产品在途生成数 → 行内占位格子
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [detailIdx, setDetailIdx] = useState(-1);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [composerFor, setComposerFor] = useState<string | null>(null); // 哪一行展开了生成条
  const [minScore, setMinScore] = useState(0); // 筛选:只看 ≥N 分(0=全部)
  const [scoreSort, setScoreSort] = useState(false); // 排序:按分高→低

  const load = useCallback(async () => {
    try {
      const [a, m, mp] = await Promise.all([etsyForgeApi.listAssets(), etsyForgeApi.listMockups(), etsyForgeApi.listManualProducts()]);
      setAssets(a.assets);
      setMockups(m.mockups);
      setManualProducts(mp.products);
      return m.mockups.length;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return -1;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // 生成后轮询，新图落库够数就停。
  useEffect(() => {
    if (pending === 0) return;
    const baseline = mockups.length;
    const t = setInterval(async () => {
      const n = await load();
      if (n >= baseline + pending) {
        setPending(0);
        setPendingByProduct({}); // 全部落库 → 清掉占位格子
        setMsg(`完成，新出 ${pending} 张`);
      }
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const { retryingIds, retry: retryMockup } = useMockupRetry(mockups, setMockups, setMsg, setError);

  const designs = assets.filter((a) => a.category === 'design' && a.status === 'success' && a.url);

  // 评分筛选/排序:只看 ≥minScore;scoreSort 时按分高→低。inline 缩略图和大图模态共用同一可见集。
  const applyView = useCallback(
    (list: MockupItem[]) => {
      const r = list.filter((m) => (m.score ?? 0) >= minScore);
      return scoreSort ? [...r].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : r;
    },
    [minScore, scoreSort],
  );
  const viewable = useMemo(() => applyView(mockups.filter((m) => m.status === 'success' && m.url)), [mockups, applyView]);

  // 打分:乐观更新本地 + 落库(失败回滚刷新)。
  const rate = (id: string, score: number) => {
    setMockups((arr) => arr.map((x) => (x.id === id ? { ...x, score } : x)));
    etsyForgeApi.scoreMockup(id, score).catch(() => void load());
  };

  // 全部图(跨产品/图库)供「＋加图」挑:素材(印花/二创/产品…) + 已有产品图,按 url 去重。
  const libraryRefs = useMemo<RefImage[]>(() => {
    const seen = new Set<string>();
    const out: RefImage[] = [];
    const push = (url: string | null, label: string) => {
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push({ url, label });
      }
    };
    for (const a of assets) if (a.status === 'success') push(a.url, CAT_LABEL[a.category] ?? '图');
    for (const m of mockups) if (m.status === 'success') push(m.url, '产品图');
    return out;
  }, [assets, mockups]);

  // 分组:手攒产品 + 采集商品各成一组,按创建时间倒序排(手攒不再置顶,和采集混排)。
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const mp of manualProducts) {
      map.set(mp.id, { key: mp.id, productId: mp.id, isManual: true, productImage: null, productTitle: mp.name, productUrl: null, createdAt: mp.created_at, items: [] });
    }
    for (const m of mockups) {
      const pid = m.source_product_id || m.source_product_title || '其他来源';
      let g = map.get(pid);
      if (!g) {
        g = { key: pid, productId: m.source_product_id, isManual: false, productImage: m.source_product_image, productTitle: m.source_product_title, productUrl: m.source_product_url, createdAt: m.created_at, items: [] };
        map.set(pid, g);
      }
      g.items.push(m);
      if (m.created_at > g.createdAt) g.createdAt = m.created_at; // 组时间取最新一张图
    }
    return [...map.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [mockups, manualProducts]);

  const onStarted = (productId?: string) => {
    setMsg('已发起生成，后台跑，稍等出现在这一行。');
    setError(null);
    setPending((p) => p + 1);
    if (productId) setPendingByProduct((m) => ({ ...m, [productId]: (m[productId] || 0) + 1 }));
    window.dispatchEvent(new Event('etsy-mockup-started')); // 通知右下角「任务」浮层立即刷新
  };

  const addManualProduct = async () => {
    setError(null);
    try {
      const r = await etsyForgeApi.createManualProduct();
      await load();
      setComposerFor(r.product.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const removeManualProduct = async (id: string) => {
    if (!confirm('删除这个手攒产品（连带它名下生成的图）？')) return;
    await etsyForgeApi.deleteManualProduct(id).catch(() => {});
    await load();
  };
  const removeMockup = async (id: string) => {
    if (!confirm('删除这张？')) return;
    await etsyForgeApi.deleteMockup(id).catch(() => {});
    await load();
  };

  const refsForGroup = (g: Group, originDesign: string | null): RefImage[] => [
    ...(originDesign ? [{ url: originDesign, label: '原印花' }] : []),
    ...g.items.filter((m) => m.url).map((m) => ({ url: m.url as string, label: '产品图' })),
  ];

  // 「按方向出图」可选源印花(两步法从印花出发):原始印花(默认,配原商品图)+ 该商品已生成的二创印花(各配它生成的产品图)。
  const basesForDirection = (g: Group, originDesign: string | null): DirectionSource[] => [
    ...(originDesign ? [{ design: originDesign, product: g.productImage, label: '印花' }] : []),
    ...assets
      .filter((a) => a.category === 'remix' && a.source_product_id === g.productId && a.status === 'success' && a.url)
      .map((a) => ({ design: a.url as string, product: mockups.find((m) => m.design_url === a.url)?.url ?? null, label: '二创印花' })),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-sm font-medium">
          我的产品（{mockups.length}）{pending > 0 && <span className="ml-1 text-xs text-amber-600">· {pending} 张生成中…</span>}
        </h3>
        <div className="flex-1" />
        {/* 评分:按分排序 + 只看 ≥N 分 */}
        <button
          type="button"
          onClick={() => setScoreSort((v) => !v)}
          title="按评分 高→低 排序"
          className={`h-7 rounded-md border px-2 text-xs ${scoreSort ? 'bg-foreground text-background' : 'hover:bg-muted'}`}
        >
          按分排序{scoreSort ? ' ✓' : ''}
        </button>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          只看
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="h-7 rounded-md border border-input bg-background px-1 text-xs"
            title="只看评分 ≥N 分的产品图"
          >
            <option value={0}>全部</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                ≥{n} 分
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center overflow-hidden rounded-md border">
          <button type="button" disabled={sizeIdx === 0} onClick={() => setSizeIdx((i) => Math.max(0, i - 1))} className="px-2 py-1 text-sm hover:bg-muted disabled:opacity-30" title="缩小">
            −
          </button>
          <span className="w-px self-stretch bg-border" />
          <button type="button" disabled={sizeIdx === THUMB_SIZES.length - 1} onClick={() => setSizeIdx((i) => Math.min(THUMB_SIZES.length - 1, i + 1))} className="px-2 py-1 text-sm hover:bg-muted disabled:opacity-30" title="放大">
            +
          </button>
        </div>
        <Button size="sm" onClick={() => void addManualProduct()}>
          ＋ 增加产品
        </Button>
      </div>
      {(msg || error) && <p className={`mb-2 text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || msg}</p>}

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">还没有产品。点「＋ 增加产品」从零开始，或去「我的图库」生成。</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {groups.map((g) => {
            const originDesign = !g.isManual ? designs.find((d) => d.source_product_id && d.source_product_id === g.productId)?.url ?? null : null;
            const open = composerFor === g.key;
            const items = applyView(g.items); // 应用评分筛选/排序
            const bases = g.productId ? basesForDirection(g, originDesign) : []; // 可用底图(印花/二创印花),手攒产品也算
            const ph = g.productId ? pendingByProduct[g.productId] || 0 : 0; // 在途生成数 → 行内占位格子
            return (
              <div key={g.key} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex shrink-0 flex-col items-start gap-1.5">
                    {/* 手攒 / 采集统一用 SrcThumb;手攒没有原商品/印花 → 显「无」占位 */}
                    <div className="flex items-start gap-2">
                      <SrcThumb label="原商品" url={g.productImage} caption={g.productTitle} href={g.productUrl} placeholder={g.isManual ? g.productTitle || '手攒产品' : undefined} onZoom={setZoom} />
                      <SrcThumb label="印花" url={originDesign} caption={g.isManual ? g.productTitle : undefined} onZoom={setZoom} />
                    </div>
                    <Button
                      size="sm"
                      variant={open ? 'default' : 'outline'}
                      disabled={!g.productId}
                      className="h-7 w-full text-xs"
                      onClick={() => setComposerFor(open ? null : g.key)}
                      title={!g.productId ? '老数据缺少产品归属,无法继续生成' : ''}
                    >
                      {open ? '收起' : '微调 ▾'}
                    </Button>
                    {g.productId && bases.length > 0 && (
                      <DirectionShotButton productId={g.productId} bases={bases} onStarted={() => onStarted(g.productId ?? undefined)} onError={setError} />
                    )}
                    {g.isManual && (
                      <button type="button" onClick={() => void removeManualProduct(g.key)} className="text-[11px] text-destructive hover:underline">
                        删除产品
                      </button>
                    )}
                  </div>
                  <div className="w-px shrink-0 self-stretch bg-border" />
                  <div className="flex flex-1 flex-wrap gap-2">
                    {g.items.length === 0 && ph === 0 ? (
                      <p className="self-center text-xs text-muted-foreground">还没有图，用右下生成条做第一张。</p>
                    ) : items.length === 0 && ph === 0 ? (
                      <p className="self-center text-xs text-muted-foreground">本组没有 ≥{minScore} 分的图。</p>
                    ) : (
                      <>
                        {items.map((m) => (
                          <ProductImageCard
                            key={m.id}
                            m={m}
                            size={THUMB_SIZES[sizeIdx]}
                            retrying={retryingIds.has(m.id)}
                            onOpen={() => setDetailIdx(viewable.findIndex((v) => v.id === m.id))}
                            onDelete={() => void removeMockup(m.id)}
                            onScore={(n) => rate(m.id, n)}
                          />
                        ))}
                        {Array.from({ length: ph }).map((_, i) => (
                          <ProductCardSkeleton key={`ph-${i}`} size={THUMB_SIZES[sizeIdx]} />
                        ))}
                      </>
                    )}
                  </div>
                </div>
                {open && g.productId && (
                  <ProductComposer productId={g.productId} defaultRefs={refsForGroup(g, originDesign)} libraryRefs={libraryRefs} onStarted={() => onStarted(g.productId ?? undefined)} onError={setError} onZoom={setZoom} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {detailIdx >= 0 && (
        <ProductMockupModal mockups={viewable} index={detailIdx} onIndexChange={setDetailIdx} keyboardEnabled={!zoom} retryingIds={retryingIds} onRetry={retryMockup} onScore={rate} onZoom={setZoom} onClose={() => setDetailIdx(-1)} />
      )}
      {zoom && <ImageLightbox images={[{ url: zoom, title: '' }]} index={0} onIndexChange={() => {}} onClose={() => setZoom(null)} />}
    </div>
  );
}
