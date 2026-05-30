'use client';

// 单张素材卡：素材图(点放大) + 来源(商品标题 + 原图缩略,点看原图) + 删除。
// 按类型视图显示来源(showSource);按来源视图已按商品分组,不重复显示来源。

import type { AssetItem } from '../api-client';
import { QuickAddChat } from './QuickAddChat';

const CAT_LABEL: Record<AssetItem['category'], string> = { design: '印花', scene: '场景', model: '模特', product: '产品', pose: '姿势' };

export function AssetCard({
  asset: a,
  showSource = true,
  onView,
  onViewOrig,
  onRemove,
}: {
  asset: AssetItem;
  showSource?: boolean;
  onView: (id: string) => void;
  onViewOrig: (url: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="group overflow-hidden rounded-md border">
      <div className="relative">
        <span className="absolute left-1 top-1 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
          {CAT_LABEL[a.category]}
        </span>
        {a.status === 'success' && a.url && a.path && (
          <QuickAddChat path={a.path} refLabel={CAT_LABEL[a.category]} className="absolute right-1 top-1" />
        )}
        {a.status === 'success' && a.url ? (
          <button type="button" onClick={() => onView(a.id)} title="点击放大" className="block w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={CAT_LABEL[a.category]} className="aspect-square w-full object-cover" />
          </button>
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-destructive/5 p-2 text-center text-[10px] text-destructive">
            {a.failure_reason || '生成失败'}
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
