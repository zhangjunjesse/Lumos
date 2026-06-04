'use client';

// 「我的产品」—— 每个产品一行(采集商品 或 手攒产品)。行内 MidJourney 式内联生成:选参考图(可跨产品/图库) + 提示词 → 生成,挂到本行。
// 「＋增加产品」建一个手攒产品占位行(无 Etsy 来源),同一个生成条。结果异步生成,前端轮询。无弹框。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type AssetItem, type ManualProduct, type MockupItem } from '../api-client';
import { ImageLightbox } from './ImageLightbox';
import { QuickAddChat } from './QuickAddChat';
import { ProductMockupModal } from './ProductMockupModal';
import { ProductComposer, type RefImage } from './ProductComposer';
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
  items: MockupItem[];
}

export function ProductTab() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [mockups, setMockups] = useState<MockupItem[]>([]);
  const [manualProducts, setManualProducts] = useState<ManualProduct[]>([]);
  const [pending, setPending] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [detailIdx, setDetailIdx] = useState(-1);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [composerFor, setComposerFor] = useState<string | null>(null); // 哪一行展开了生成条

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
        setMsg(`完成，新出 ${pending} 张`);
      }
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const { retryingIds, retry: retryMockup } = useMockupRetry(mockups, setMockups, setMsg, setError);

  const designs = assets.filter((a) => a.category === 'design' && a.status === 'success' && a.url);
  const viewable = useMemo(() => mockups.filter((m) => m.status === 'success' && m.url), [mockups]);

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

  // 分组:手攒产品在前(含空占位行),再并入采集商品的生成图组。
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const mp of manualProducts) {
      map.set(mp.id, { key: mp.id, productId: mp.id, isManual: true, productImage: null, productTitle: mp.name, productUrl: null, items: [] });
    }
    for (const m of mockups) {
      const pid = m.source_product_id || m.source_product_title || '其他来源';
      let g = map.get(pid);
      if (!g) {
        g = { key: pid, productId: m.source_product_id, isManual: false, productImage: m.source_product_image, productTitle: m.source_product_title, productUrl: m.source_product_url, items: [] };
        map.set(pid, g);
      }
      g.items.push(m);
    }
    return [...map.values()];
  }, [mockups, manualProducts]);

  const onStarted = () => {
    setMsg('已发起生成，后台跑，稍等出现在这一行。');
    setError(null);
    setPending((p) => p + 1);
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

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-sm font-medium">
          我的产品（{mockups.length}）{pending > 0 && <span className="ml-1 text-xs text-amber-600">· {pending} 张生成中…</span>}
        </h3>
        <div className="flex-1" />
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
            return (
              <div key={g.key} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex shrink-0 flex-col items-start gap-1.5">
                    <div className="flex items-start gap-2">
                      {g.isManual ? (
                        <div className="flex size-20 flex-col items-center justify-center rounded-md border border-dashed text-center text-[10px] text-muted-foreground">
                          <span className="line-clamp-2 px-1">{g.productTitle || '手攒产品'}</span>
                          <button type="button" onClick={() => void removeManualProduct(g.key)} className="mt-0.5 text-destructive hover:underline">
                            删除
                          </button>
                        </div>
                      ) : (
                        <>
                          <SrcThumb label="原商品" url={g.productImage} caption={g.productTitle} href={g.productUrl} onZoom={setZoom} />
                          <SrcThumb label="印花" url={originDesign} onZoom={setZoom} />
                        </>
                      )}
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
                  </div>
                  <div className="w-px shrink-0 self-stretch bg-border" />
                  <div className="flex flex-1 flex-wrap gap-2">
                    {g.items.length === 0 && <p className="self-center text-xs text-muted-foreground">还没有图，用右下生成条做第一张。</p>}
                    {g.items.map((m) => (
                      <div
                        key={m.id}
                        style={{ width: THUMB_SIZES[sizeIdx], height: THUMB_SIZES[sizeIdx] }}
                        className={`group relative shrink-0 overflow-hidden rounded border bg-card ${retryingIds.has(m.id) ? 'ring-2 ring-amber-500' : ''}`}
                      >
                        {retryingIds.has(m.id) && (
                          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-amber-500/35">
                            <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            <span className="rounded bg-amber-600 px-1.5 py-0.5 text-[9px] font-medium text-white">重试中…</span>
                          </div>
                        )}
                        {m.status === 'success' && m.url ? (
                          <>
                            <button type="button" onClick={() => setDetailIdx(viewable.findIndex((v) => v.id === m.id))} title="点击看溯源" className="block size-full">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.url} alt={m.design_label} className="size-full object-cover" />
                            </button>
                            <QuickAddChat imageUrl={m.url} refLabel="带印花T" className="absolute right-0.5 top-0.5" />
                          </>
                        ) : (
                          <div className="flex size-full items-center justify-center bg-destructive/5 p-1 text-center text-[8px] text-destructive">{m.failure_reason || '失败'}</div>
                        )}
                        <button type="button" onClick={() => void removeMockup(m.id)} className="absolute left-0.5 top-0.5 rounded bg-black/50 px-1 text-[8px] text-white opacity-0 transition group-hover:opacity-100">
                          删
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                {open && g.productId && (
                  <ProductComposer productId={g.productId} defaultRefs={refsForGroup(g, originDesign)} libraryRefs={libraryRefs} onStarted={onStarted} onError={setError} onZoom={setZoom} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {detailIdx >= 0 && (
        <ProductMockupModal mockups={viewable} index={detailIdx} onIndexChange={setDetailIdx} keyboardEnabled={!zoom} retryingIds={retryingIds} onRetry={retryMockup} onZoom={setZoom} onClose={() => setDetailIdx(-1)} />
      )}
      {zoom && <ImageLightbox images={[{ url: zoom, title: '' }]} index={0} onIndexChange={() => {}} onClose={() => setZoom(null)} />}
    </div>
  );
}
