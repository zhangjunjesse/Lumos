'use client';

// 点产品图(带印花 T)弹出的溯源详情:成品大图 + 用的印花 + 最初来自哪个采集的 Etsy 商品(图/标题/链接)。
// 支持键盘 ←/→ 切上一张/下一张、Esc 关闭(放大层开着时让位、不抢键盘)。点成品/印花/原商品图可再放大。

import { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScoreBar } from './ScoreBar';
import type { MockupItem } from '../api-client';

export function ProductMockupModal({
  mockups,
  index,
  onIndexChange,
  keyboardEnabled = true,
  retryingIds,
  onRetry,
  onScore,
  onZoom,
  onClose,
}: {
  mockups: MockupItem[];
  index: number;
  onIndexChange: (i: number) => void;
  keyboardEnabled?: boolean;
  retryingIds?: Set<string>; // 正在重合成的 mockup id 集合(支持同时多张)
  onRetry?: (id: string) => void; // 用当前图片服务商重新合成、覆盖
  onScore?: (id: string, score: number) => void; // 打分 1-10(0=清除)
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
      else if (onScore) {
        // 快速打分:1-9 → 1-9 分,0 → 10 分,Backspace → 清除。
        const cur = mockups[index];
        if (!cur) return;
        if (e.key >= '1' && e.key <= '9') onScore(cur.id, Number(e.key));
        else if (e.key === '0') onScore(cur.id, 10);
        else if (e.key === 'Backspace') onScore(cur.id, 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, keyboardEnabled, onScore, mockups, index]);

  const mockup = mockups[index];
  if (!mockup) return null;
  const navBtn = 'flex size-8 items-center justify-center rounded-full border bg-card text-lg hover:bg-muted disabled:opacity-30';
  const retrying = !!retryingIds?.has(mockup.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">带印花 T · 溯源</span>
            {count > 1 && <span className="text-xs text-muted-foreground">{index + 1} / {count} · ←/→ 切换</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {onRetry && (
              <Button
                size="sm"
                variant="outline"
                disabled={retrying}
                title="用当前「设置→图片生成」的服务商重新合成这张,覆盖原图"
                onClick={() => onRetry(mockup.id)}
              >
                {retrying ? '合成中…' : '重试合成'}
              </Button>
            )}
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
          {/* 成品大图 + 评分 */}
          <div className="space-y-2">
            <button type="button" onClick={() => mockup.url && onZoom(mockup.url)} title="点击放大" className="relative block w-full overflow-hidden rounded-md border">
              {mockup.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mockup.url} alt="带印花 T" className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square items-center justify-center bg-destructive/5 text-xs text-destructive">{mockup.failure_reason || '失败'}</div>
              )}
              {retrying && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm text-white">重新合成中…(最长 10 分钟)</div>
              )}
            </button>
            {onScore && mockup.status === 'success' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">评分{mockup.score > 0 ? ` · ${mockup.score}` : ''}</span>
                  <span className="text-[10px] text-muted-foreground">键盘 1-9 · 0=10 · ⌫清除</span>
                </div>
                <ScoreBar value={mockup.score} onPick={(n) => onScore(mockup.id, n)} />
              </div>
            )}
          </div>

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
