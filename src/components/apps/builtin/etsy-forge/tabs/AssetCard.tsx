'use client';

// 单张素材卡：素材图(点放大) + 来源(商品标题 + 原图缩略,点看原图) + 删除。
// 按类型视图显示来源(showSource);按来源视图已按商品分组,不重复显示来源。

import { useState } from 'react';
import type { AssetItem } from '../api-client';
import { QuickAddChat } from './QuickAddChat';

const CAT_LABEL: Record<AssetItem['category'], string> = { design: '印花', scene: '场景', model: '模特', product: '产品', pose: '姿势', remix: '二创' };

export function AssetCard({
  asset: a,
  showSource = true,
  onView,
  onViewOrig,
  onRemove,
  onRetry,
}: {
  asset: AssetItem;
  showSource?: boolean;
  onView: (id: string) => void;
  onViewOrig: (url: string) => void;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="group overflow-hidden rounded-md border">
      <div className="relative">
        <span className="absolute left-1 top-1 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
          {CAT_LABEL[a.category]}
        </span>
        {a.quality_flag === 'weak' && (
          <span
            className="absolute left-1 top-6 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-medium text-white"
            title={a.quality_note || '质检:有硬伤(白底框/多余文字/糊…)'}
          >
            弱
          </span>
        )}
        {a.status === 'success' && a.url && a.path && (
          <QuickAddChat path={a.path} refLabel={CAT_LABEL[a.category]} className="absolute right-1 top-1" />
        )}
        {a.status === 'success' && a.url ? (
          <button type="button" onClick={() => onView(a.id)} title="点击放大" className="block w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={CAT_LABEL[a.category]} className="aspect-square w-full object-cover" />
          </button>
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 bg-destructive/5 p-2 text-center text-[10px] text-destructive">
            <span className="line-clamp-3">{a.failure_reason || '生成失败'}</span>
            {onRetry && a.category !== 'design' && (
              <button
                type="button"
                disabled={retrying}
                onClick={async () => {
                  setRetrying(true);
                  try {
                    await onRetry(a.id);
                  } finally {
                    setRetrying(false);
                  }
                }}
                className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] hover:bg-destructive/10 disabled:opacity-50"
              >
                {retrying ? '重试中…' : '重试'}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="space-y-1 p-1.5">
        <div className="flex items-center justify-between gap-1">
          {showSource ? (
            <span className="line-clamp-1 text-[10px] text-muted-foreground" title={a.source_product_title ?? ''}>
              来自：{a.source_product_title || '—'}
            </span>
          ) : (
            <span />
          )}
          {a.category === 'design' ? (
            <span className="shrink-0 text-[9px] text-muted-foreground" title="印花在图库「查看抠图」里重抠/删除">
              图库管理
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onRemove(a.id)}
              className="shrink-0 text-[10px] text-destructive hover:underline"
            >
              删
            </button>
          )}
        </div>
        {showSource && a.source_image_urls.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">原图</span>
            {a.source_image_urls.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onViewOrig(u)}
                title="看原图"
                className="size-8 shrink-0 overflow-hidden rounded border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="原图" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
