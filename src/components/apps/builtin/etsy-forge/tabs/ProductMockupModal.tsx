'use client';

// 点产品图(带印花 T)弹出的溯源详情:成品大图 + 用的印花 + 最初来自哪个采集的 Etsy 商品(图/标题/链接)。
// 支持键盘 ←/→ 切上一张/下一张、Esc 关闭(放大层开着时让位、不抢键盘)。点成品/印花/原商品图可再放大。

import { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { MockupItem } from '../api-client';

export function ProductMockupModal({
  mockups,
  index,
  onIndexChange,
  keyboardEnabled = true,
  onZoom,
  onClose,
}: {
  mockups: MockupItem[];
  index: number;
  onIndexChange: (i: number) => void;
  keyboardEnabled?: boolean;
  onZoom: (url: string) => void;
  onClose: () => void;
}) {
  const count = mockups.length;
  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      onIndexChange((index + delta + count) % count);
    },
    [index, count, onIndexChange],
  );

  useEffect(() => {
    if (!keyboardEnabled) return; // 放大层开着时不抢键盘
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, keyboardEnabled]);

  const mockup = mockups[index];
  if (!mockup) return null;
  const navBtn = 'flex size-8 items-center justify-center rounded-full border bg-card text-lg hover:bg-muted disabled:opacity-30';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">带印花 T · 溯源</span>
            {count > 1 && <span className="text-xs text-muted-foreground">{index + 1} / {count} · ←/→ 切换</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {count > 1 && (
              <>
                <button type="button" aria-label="上一张" onClick={() => go(-1)} className={navBtn}>
                  ‹
                </button>
                <button type="button" aria-label="下一张" onClick={() => go(1)} className={navBtn}>
                  ›
                </button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 sm:grid-cols-[1.4fr_1fr]">
          {/* 成品大图 */}
          <button type="button" onClick={() => mockup.url && onZoom(mockup.url)} title="点击放大" className="block overflow-hidden rounded-md border">
            {mockup.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mockup.url} alt="带印花 T" className="aspect-square w-full object-cover" />
            ) : (
              <div className="flex aspect-square items-center justify-center bg-destructive/5 text-xs text-destructive">{mockup.failure_reason || '失败'}</div>
            )}
          </button>

          {/* 血缘:印花 + 原始商品 */}
          <div className="space-y-4 text-sm">
            <Provenance title="用的印花" imageUrl={mockup.design_url} caption={mockup.design_label || '印花'} onZoom={onZoom} missing="印花信息缺失" />
            <Provenance
              title="最初来自这个采集商品"
              imageUrl={mockup.source_product_image}
              caption={mockup.source_product_title || '(未知商品)'}
              href={mockup.source_product_url}
              onZoom={onZoom}
              missing="原始商品缺失（老数据未记血缘，重新生成即带上）"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Provenance({
  title,
  imageUrl,
  caption,
  href,
  onZoom,
  missing,
}: {
  title: string;
  imageUrl: string | null;
  caption: string;
  href?: string | null;
  onZoom: (url: string) => void;
  missing: string;
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</h4>
      {imageUrl ? (
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => onZoom(imageUrl)} title="放大" className="size-20 shrink-0 overflow-hidden rounded-md border hover:ring-1 hover:ring-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
          </button>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="line-clamp-3 text-xs">{caption}</p>
            {href && (
              <a href={href} target="_blank" rel="noreferrer" className="inline-block text-xs text-blue-600 hover:underline">
                在 Etsy 查看 ↗
              </a>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{missing}</p>
      )}
    </div>
  );
}
