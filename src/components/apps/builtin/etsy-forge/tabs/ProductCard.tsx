'use client';

// 商品列表里的单个商品卡（主图 + EHunt 指标 + 勾选 + 详情采集状态）。

import { useState } from 'react';
import type { Product } from '../api-client';
import { QuickAddChat } from './QuickAddChat';

const DETAIL_LABEL: Record<string, string> = {
  idle: '',
  running: '爬取中',
  success: '已采集',
  failed: '失败',
};

export function ProductCard({ product: p, onToggle }: { product: Product; onToggle: (p: Product) => void }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(p.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可用时静默——不影响采集主流程 */
    }
  };

  return (
    <div
      className={`overflow-hidden rounded-md border ${p.selected ? 'border-foreground ring-1 ring-foreground' : 'border-border'}`}
    >
      <button type="button" onClick={() => onToggle(p)} className="block w-full">
        <div className="relative aspect-square bg-muted">
          {p.main_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.main_image_url} alt={p.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">无主图</div>
          )}
          {p.selected && (
            <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded bg-foreground text-xs text-background">
              ✓
            </span>
          )}
          {p.detail_status !== 'idle' && (
            <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
              {DETAIL_LABEL[p.detail_status]}
              {p.detail_status === 'success' ? ` ${p.detail_image_count}` : ''}
            </span>
          )}
        </div>
      </button>
      <div className="p-2">
        <div className="group flex items-start gap-1">
          <p className="line-clamp-2 flex-1 text-xs text-foreground">{p.title || '(无标题)'}</p>
          {p.title && <QuickAddChat text={p.title} refLabel="商品标题" className="mt-0.5 shrink-0" label="标题加到创作助手" />}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">
            {p.price?.trim() ? p.price : '—'}
          </span>
          <button
            type="button"
            onClick={() => void copyLink()}
            disabled={!p.url}
            className="shrink-0 text-[10px] text-primary hover:underline disabled:opacity-40"
          >
            {copied ? '已复制' : '复制链接'}
          </button>
        </div>
        {p.rating && (
          <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            ★ {p.rating}
            {p.reviews ? ` · ${p.reviews} 评价` : ''}
          </p>
        )}
        {p.ehunt ? (
          <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
            销量 {p.ehunt.salesTotal ?? '?'}
            {p.ehunt.salesRecent != null ? `(${p.ehunt.salesRecent})` : ''} · 收藏 {p.ehunt.favorites ?? '?'}
            {p.ehunt.listedDate ? ` · ${p.ehunt.listedDate}` : ''}
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {p.ehunt_status === 'not_adspower' ? '无 EHunt(非 AdsPower)' : '无 EHunt'}
          </p>
        )}
      </div>
    </div>
  );
}
