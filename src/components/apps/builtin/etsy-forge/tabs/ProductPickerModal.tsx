'use client';

// 「增加产品」弹框:选印花(抠的印花 + 灵感二创图,选一个) + 选产品图(空白T,可多选=多颜色一次出) → 生成。
// 从 ProductTab 拆出,让产品 tab 默认只展示结果、选择动作进弹框。ThumbPick / Empty 在此定义供两处用。

import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { AssetItem } from '../api-client';
import type { CreationImage } from './creation-images';

export interface DesignPick {
  url: string;
  path?: string;
  label: string;
  sourceProductId?: string; // 血缘:这印花来自哪个采集的 Etsy 商品
}

export function ProductPickerModal({
  designs,
  products,
  creationImgs,
  design,
  setDesign,
  productSel,
  toggleProduct,
  busy,
  msg,
  error,
  onGenerate,
  onZoom,
  onClose,
}: {
  designs: AssetItem[];
  products: AssetItem[];
  creationImgs: CreationImage[];
  design: DesignPick | null;
  setDesign: (d: DesignPick) => void;
  productSel: Set<string>;
  toggleProduct: (id: string) => void;
  busy: boolean;
  msg: string | null;
  error: string | null;
  onGenerate: () => void;
  onZoom: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">增加产品</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <section>
            <h3 className="mb-1.5 text-sm font-medium">
              1 选印花 <span className="text-xs font-normal text-muted-foreground">抠的印花 + 灵感二创图，选一个</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {designs.map((a) => (
                <ThumbPick key={a.id} url={a.url as string} active={design?.url === a.url} label="印花" onClick={() => setDesign({ url: a.url as string, path: a.path ?? undefined, label: '印花', sourceProductId: a.source_product_id ?? undefined })} onZoom={() => onZoom(a.url as string)} />
              ))}
              {creationImgs.map((im) => (
                <ThumbPick key={im.url} url={im.url} active={design?.url === im.url} label="二创" onClick={() => setDesign({ url: im.url, label: '二创图' })} onZoom={() => onZoom(im.url)} />
              ))}
              {designs.length === 0 && creationImgs.length === 0 && (
                <Empty>还没有印花。去「我关注的商品」抠印花，或在创作助手生成二创图。</Empty>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-1.5 text-sm font-medium">
              2 选产品图 <span className="text-xs font-normal text-muted-foreground">空白 T，可多选 = 多颜色一次出</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {products.map((a) => (
                <ThumbPick key={a.id} url={a.url as string} active={productSel.has(a.id)} onClick={() => toggleProduct(a.id)} onZoom={() => onZoom(a.url as string)} />
              ))}
              {products.length === 0 && <Empty>还没有产品图。去「我关注的商品」选商品「生成素材」出空白 T。</Empty>}
            </div>
          </section>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-4 py-3">
          <Button disabled={busy || !design || productSel.size === 0} onClick={onGenerate}>
            {busy ? '发起中…' : `生成带印花 T（${productSel.size} 色）`}
          </Button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

export function ThumbPick({
  url,
  active,
  label,
  onClick,
  onZoom,
}: {
  url: string;
  active: boolean;
  label?: string;
  onClick: () => void;
  onZoom?: () => void;
}) {
  return (
    <div className="group relative size-16">
      <button
        type="button"
        onClick={onClick}
        className={`block size-16 overflow-hidden rounded border ${active ? 'ring-2 ring-foreground' : 'hover:ring-1 hover:ring-foreground'}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="缩略" className="h-full w-full object-cover" />
        {label && <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[8px] text-white">{label}</span>}
        {active && (
          <span className="absolute right-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-[9px] text-background">
            ✓
          </span>
        )}
      </button>
      {onZoom && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onZoom();
          }}
          title="放大查看"
          className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[11px] leading-none text-white opacity-0 transition group-hover:opacity-100"
        >
          ⤢
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">{children}</p>;
}
