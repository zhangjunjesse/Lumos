'use client';

// 「按方向出图」弹框:选 1 张源印花(默认原始印花,可选该商品已生成的二创印花)+ 点 1 个方向 →
// 两步法出图(先按方向出新印花、再印到 T 出产品图,两张都留)。每个源同时展示〔印花 + 它对应的产品图〕,可 🔍 看大图。
// 宽弹框、左右两栏:左=选源,右=选方向。只对有印花的采集商品显示。

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { etsyForgeApi, type RemixStrategy } from '../api-client';
import { ImageLightbox } from './ImageLightbox';

export interface DirectionSource {
  design: string; // 源印花 url(两步法真正用它当底)
  product: string | null; // 这张印花对应的产品图(展示用,没有则空)
  label: string; // 印花 / 二创印花
}

// 一张缩略图:点图=选这个源,角上 🔍=看大图(不触发选中)。
function Thumb({ url, caption, onSelect, onZoom }: { url: string | null; caption: string; onSelect: () => void; onZoom: (url: string) => void }) {
  return (
    <div className="relative flex flex-col items-center gap-0.5">
      {url ? (
        <button type="button" onClick={onSelect} className="block size-28 overflow-hidden rounded border bg-muted hover:opacity-90" title="点选这个源印花">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={caption} loading="lazy" decoding="async" className="size-full object-cover" />
        </button>
      ) : (
        <div className="flex size-28 items-center justify-center rounded border border-dashed text-center text-[10px] text-muted-foreground">无产品图</div>
      )}
      {url && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onZoom(url);
          }}
          title="看大图"
          className="absolute right-1 top-1 rounded bg-black/55 px-1 text-[11px] leading-tight text-white hover:bg-black/80"
        >
          🔍
        </button>
      )}
      <span className="text-[9px] text-muted-foreground">{caption}</span>
    </div>
  );
}

export function DirectionShotButton({
  productId,
  bases,
  onStarted,
  onError,
}: {
  productId: string;
  bases: DirectionSource[]; // [原始印花, ...该商品的二创印花]。第一张(印花)为默认。
  onStarted: () => void;
  onError: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [strategies, setStrategies] = useState<RemixStrategy[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  // 派生当前源:选过且仍在候选里就用它,否则默认第一张(印花)。
  const baseUrl = picked && bases.some((b) => b.design === picked) ? picked : bases[0]?.design ?? '';

  useEffect(() => {
    if (!open || loaded) return;
    void etsyForgeApi
      .listStrategies()
      .then((r) => setStrategies(r.strategies.filter((s) => s.enabled)))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  const shoot = (code: string) => {
    if (busy || !baseUrl) return;
    setBusy(true);
    etsyForgeApi
      .composeByDirection(productId, code, baseUrl)
      .then(() => {
        onStarted();
        setOpen(false);
      })
      .catch((e) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={() => setOpen(true)}>
        按方向出图…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[95vw] sm:max-w-5xl"
          onEscapeKeyDown={(e) => {
            if (zoom) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base">按方向出图</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-xs text-muted-foreground">两步:先按方向出一张新印花,再印到 T 出产品图——两张都会留(印花进图库/灵感,产品图进这一行)。</p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_300px]">
            {/* 左:选源印花,同时给看它对应的产品图,可 🔍 看大图 */}
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium">① 选源印花(改谁)· 每个同时给你看它对应的产品图(🔍 看大图)</p>
              <div className="flex max-h-[60vh] flex-wrap gap-2 overflow-y-auto pr-1">
                {bases.map((b, i) => (
                  <div
                    key={b.design || i}
                    className={`flex shrink-0 items-center gap-1.5 rounded-md border p-1.5 ${baseUrl === b.design ? 'ring-2 ring-foreground' : ''}`}
                  >
                    <Thumb url={b.design} caption={b.label} onSelect={() => setPicked(b.design)} onZoom={setZoom} />
                    <span className="text-muted-foreground">→</span>
                    <Thumb url={b.product} caption="产品" onSelect={() => setPicked(b.design)} onZoom={setZoom} />
                  </div>
                ))}
              </div>
            </div>

            {/* 右:选方向 */}
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-medium">② 点一个方向 → 出 1 套</p>
              <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
                {loaded && strategies.length === 0 && <p className="text-xs text-muted-foreground">还没有方向，去「设置→二创方向矩阵」加。</p>}
                {strategies.map((d) => (
                  <button
                    key={d.code}
                    type="button"
                    disabled={busy || !baseUrl}
                    onClick={() => shoot(d.code)}
                    className="flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium">{d.code}</span>
                    <span className="leading-tight">
                      <span className="font-medium">{d.label}</span>
                      <span className="ml-1.5 text-muted-foreground">{d.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">设置→二创方向矩阵 可增删改</p>
            </div>
          </div>
          {busy && <p className="text-xs text-muted-foreground">出图中…（发起后可关弹框，去右下角「任务」看进度）</p>}
        </DialogContent>
      </Dialog>
      {/* 大图查看器:portal 到 body + 高层级,盖在弹框之上(弹框有 transform,放里面会被困住) */}
      {zoom &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="relative z-[60]">
            <ImageLightbox images={[{ url: zoom }]} index={0} onIndexChange={() => {}} onClose={() => setZoom(null)} />
          </div>,
          document.body,
        )}
    </>
  );
}
