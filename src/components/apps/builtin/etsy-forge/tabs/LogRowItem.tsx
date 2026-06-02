'use client';

// 单条日志:时间/级别/操作域/商品 + 输入图缩略图(点放大)+ 内容(长则折叠,可展开)。

import { useState } from 'react';
import { ImageLightbox } from './ImageLightbox';
import type { LogItem } from '../api-client';

const LEVEL_CLS: Record<LogItem['level'], string> = {
  info: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600',
  error: 'text-destructive',
};

const LONG = 140; // 超过这个长度的内容默认折叠

export function LogRowItem({ log: l }: { log: LogItem }) {
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState(-1);
  const isLong = (l.message?.length ?? 0) > LONG || (l.message?.split('\n').length ?? 0) > 2;

  return (
    <div className="rounded border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
        <span className={`shrink-0 font-semibold ${LEVEL_CLS[l.level] ?? ''}`}>{l.level.toUpperCase()}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">{l.scope}</span>
        {l.product && (
          <span className="max-w-[220px] truncate rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary" title={l.product}>
            {l.product}
          </span>
        )}
        {isLong && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="ml-auto shrink-0 text-[10px] text-primary hover:underline">
            {expanded ? '收起' : '展开'}
          </button>
        )}
      </div>

      {l.images.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {l.images.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={() => setLightbox(i)}
              title="点击放大"
              className="size-14 overflow-hidden rounded border hover:ring-1 hover:ring-foreground"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="输入图" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {l.message && (
        <p className={`mt-1 whitespace-pre-wrap break-words text-muted-foreground ${!expanded && isLong ? 'line-clamp-2' : ''}`}>
          {l.message}
        </p>
      )}

      {lightbox >= 0 && (
        <ImageLightbox
          images={l.images.map((u) => ({ url: u }))}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(-1)}
        />
      )}
    </div>
  );
}
