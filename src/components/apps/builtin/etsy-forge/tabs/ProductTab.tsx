'use client';

// 产品 tab —— 印花 × 确定颜色空白 T → inpaint → 带印花平铺 T(颜色焊在产品图里、印花贴合布料)。
// 印花来源：素材库「印花」(抠的) + 灵感(二创图)；产品图：素材库「产品图」(多选 = 多颜色一次出)。
// 也是验证 inpaint 锁色+贴合的地基。结果异步生成，前端轮询。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type AssetItem, type MockupItem } from '../api-client';
import { useCreationSession } from './use-creation-session';
import { extractCreationImages } from './creation-images';
import { ImageLightbox } from './ImageLightbox';
import { QuickAddChat } from './QuickAddChat';
import { ProductPickerModal, Empty, type DesignPick } from './ProductPickerModal';
import { ProductMockupModal } from './ProductMockupModal';
import { RemixMoreModal, type RemixMoreTarget } from './RemixMoreModal';
import { SrcThumb } from './SrcThumb';

const THUMB_SIZES = [80, 112, 144, 180]; // 产品图缩略尺寸档位(px)

export function ProductTab() {
  const session = useCreationSession();
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [mockups, setMockups] = useState<MockupItem[]>([]);
  const [design, setDesign] = useState<DesignPick | null>(null);
  const [productSel, setProductSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailIdx, setDetailIdx] = useState(-1); // 溯源弹框当前看第几张(在 viewable 里的下标)
  const [sizeIdx, setSizeIdx] = useState(1); // 产品图缩略尺寸档位(默认调大一档)
  const [remixTarget, setRemixTarget] = useState<RemixMoreTarget | null>(null); // 继续二创弹框

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([etsyForgeApi.listAssets(), etsyForgeApi.listMockups()]);
      setAssets(a.assets);
      setMockups(m.mockups);
      return m.mockups.length;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return -1;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // 生成后轮询，每张落库够数就停。
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

  const designs = assets.filter((a) => a.category === 'design' && a.status === 'success' && a.url);
  const products = assets.filter((a) => a.category === 'product' && a.status === 'success' && a.url);
  const creationImgs = useMemo(() => extractCreationImages(session.messages), [session.messages]);
  const viewable = useMemo(() => mockups.filter((m) => m.status === 'success' && m.url), [mockups]); // 可看溯源/可翻页的成品
  // 按「原商品」分组:一行 = 一个原始商品;行内再按印花拆小组(印花 + 它的产品图),横排换行。
  const groups = useMemo(() => {
    const byProduct = new Map<string, {
      key: string;
      sourceProductId: string | null;
      productImage: string | null;
      productTitle: string | null;
      productUrl: string | null;
      items: MockupItem[];
    }>();
    for (const m of mockups) {
      const pKey = m.source_product_id || m.source_product_title || '其他来源';
      let g = byProduct.get(pKey);
      if (!g) {
        g = { key: pKey, sourceProductId: m.source_product_id, productImage: m.source_product_image, productTitle: m.source_product_title, productUrl: m.source_product_url, items: [] };
        byProduct.set(pKey, g);
      }
      g.items.push(m);
    }
    return [...byProduct.values()];
  }, [mockups]);

  const toggleProduct = (id: string) =>
    setProductSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const generate = () => {
    if (!design || productSel.size === 0) return;
    setBusy(true);
    setError(null);
    setMsg(`生成 ${productSel.size} 张中（后台跑，inpaint 较慢）…`);
    etsyForgeApi
      .generateMockups({ path: design.path, url: design.path ? undefined : design.url, label: design.label, source_product_id: design.sourceProductId }, [...productSel])
      .then((r) => {
        setPending(r.started);
        setProductSel(new Set());
        setPickerOpen(false); // 发起后关弹框,回到结果列表看生成进度
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setMsg(null);
      })
      .finally(() => setBusy(false));
  };

  const removeMockup = async (id: string) => {
    if (!confirm('删除这张？')) return;
    await etsyForgeApi.deleteMockup(id).catch(() => {});
    await load();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-medium">
            带印花 T（{mockups.length}）{pending > 0 && <span className="ml-1 text-xs text-amber-600">· {pending} 张生成中…</span>}
          </h3>
          <div className="flex-1" />
          {/* 产品图大小:缩小 / 放大 */}
          <div className="flex items-center overflow-hidden rounded-md border">
            <button
              type="button"
              disabled={sizeIdx === 0}
              onClick={() => setSizeIdx((i) => Math.max(0, i - 1))}
              className="px-2 py-1 text-sm hover:bg-muted disabled:opacity-30"
              title="缩小"
            >
              −
            </button>
            <span className="w-px self-stretch bg-border" />
            <button
              type="button"
              disabled={sizeIdx === THUMB_SIZES.length - 1}
              onClick={() => setSizeIdx((i) => Math.min(THUMB_SIZES.length - 1, i + 1))}
              className="px-2 py-1 text-sm hover:bg-muted disabled:opacity-30"
              title="放大"
            >
              +
            </button>
          </div>
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            增加产品
          </Button>
        </div>
        {(msg || error) && (
          <p className={`mb-2 text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{error || msg}</p>
        )}
        {mockups.length === 0 ? (
          <Empty>还没有。选印花 + 产品图，点生成。</Empty>
        ) : (
          <div className="divide-y rounded-lg border">
            {groups.map((g) => {
              // 左侧的"原始印花"= 抠印花结果(design 类素材,按 source_product_id 配对)
              const originDesign = designs.find((d) => d.source_product_id && d.source_product_id === g.sourceProductId)?.url ?? null;
              return (
                <div key={g.key} className="flex items-start gap-3 p-3">
                  {/* 左:原商品 + 原始印花 + 继续二创 */}
                  <div className="flex shrink-0 flex-col items-start gap-1.5">
                    <div className="flex items-start gap-2">
                      <SrcThumb label="原商品" url={g.productImage} caption={g.productTitle} href={g.productUrl} onZoom={setZoom} />
                      <SrcThumb label="印花" url={originDesign} onZoom={setZoom} />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!g.sourceProductId}
                      className="h-7 w-full text-xs"
                      onClick={() =>
                        setRemixTarget({
                          productId: g.sourceProductId || '',
                          title: g.productTitle,
                          bases: [
                            ...(originDesign ? [{ url: originDesign, label: '原印花' }] : []),
                            ...g.items.filter((m) => m.url).map((m) => ({ url: m.url as string, label: '产品图' })),
                          ],
                        })
                      }
                    >
                      继续二创
                    </Button>
                  </div>
                  <div className="w-px shrink-0 self-stretch bg-border" />
                  {/* 右:产品图,平铺横排、自动换行 */}
                  <div className="flex flex-1 flex-wrap gap-2">
                    {g.items.map((m) => (
                      <div key={m.id} style={{ width: THUMB_SIZES[sizeIdx], height: THUMB_SIZES[sizeIdx] }} className="group relative shrink-0 overflow-hidden rounded border bg-card">
                        {m.status === 'success' && m.url ? (
                          <>
                            <button type="button" onClick={() => setDetailIdx(viewable.findIndex((v) => v.id === m.id))} title="点击看溯源" className="block size-full">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.url} alt={m.design_label} className="size-full object-cover" />
                            </button>
                            <QuickAddChat imageUrl={m.url} refLabel="带印花T" className="absolute right-0.5 top-0.5" />
                          </>
                        ) : (
                          <div className="flex size-full items-center justify-center bg-destructive/5 p-1 text-center text-[8px] text-destructive">
                            {m.failure_reason || '失败'}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => void removeMockup(m.id)}
                          className="absolute left-0.5 top-0.5 rounded bg-black/50 px-1 text-[8px] text-white opacity-0 transition group-hover:opacity-100"
                        >
                          删
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {detailIdx >= 0 && (
        <ProductMockupModal
          mockups={viewable}
          index={detailIdx}
          onIndexChange={setDetailIdx}
          keyboardEnabled={!zoom}
          onZoom={setZoom}
          onClose={() => setDetailIdx(-1)}
        />
      )}
      {zoom && (
        <ImageLightbox images={[{ url: zoom, title: '' }]} index={0} onIndexChange={() => {}} onClose={() => setZoom(null)} />
      )}

      {remixTarget && (
        <RemixMoreModal
          target={remixTarget}
          onClose={() => setRemixTarget(null)}
          onStarted={() => {
            setMsg('已发起「继续二创」,后台跑,稍等出现在这个商品下。');
            setPending((p) => p + 1); // 复用轮询:等新图落库
          }}
        />
      )}

      {pickerOpen && (
        <ProductPickerModal
          designs={designs}
          products={products}
          creationImgs={creationImgs}
          design={design}
          setDesign={setDesign}
          productSel={productSel}
          toggleProduct={toggleProduct}
          busy={busy}
          msg={msg}
          error={error}
          onGenerate={generate}
          onZoom={setZoom}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
