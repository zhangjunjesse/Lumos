'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { Product, ProductCard } from './use-products';

const LOW_STOCK_THRESHOLD = 5;

export function ProductListItem({
  product,
  active,
  onSelect,
}: {
  product: Product;
  active: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const broken = product.links.filter((l) => l.health === 'broken').length;
  const okLinks = product.links.filter((l) => l.health !== 'broken' && l.url?.trim()).length;
  const cardSummary = summarizeCards(product.cards ?? []);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
          active ? 'border-foreground/30 bg-muted/40' : 'border-transparent hover:bg-muted/30',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{product.title || '未命名'}</span>
          <StatusBadge status={product.status} />
        </div>
        <span className="truncate text-[11px] text-muted-foreground">
          {product.category || '未分类'} · ￥{(product.suggested_price ?? 0).toFixed(2)}
        </span>
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="truncate">
            卖出 {product.total_sold ?? 0}
            {' · '}
            链接 {okLinks}/{product.links.length}
            {cardSummary.totalCards > 0 ? ` · 卡密 ${cardSummary.label}` : ''}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {broken > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3" />
                {broken} 失效
              </span>
            ) : null}
            {cardSummary.lowStock ? (
              <span className="inline-flex items-center gap-0.5 text-destructive">
                <AlertTriangle className="size-3" />
                卡密不足
              </span>
            ) : null}
          </span>
        </div>
      </button>
    </li>
  );
}

function summarizeCards(cards: ProductCard[]): {
  totalCards: number;
  label: string;
  lowStock: boolean;
} {
  const enabled = cards.filter((c) => c.enabled !== false);
  if (enabled.length === 0) return { totalCards: 0, label: '', lowStock: false };
  // 只把 data 类型有库存语义；其他类型(text/api/image)视为"无限"
  let remaining = 0;
  let total = 0;
  let hasData = false;
  let lowStock = false;
  for (const c of enabled) {
    if (c.kind === 'data') {
      hasData = true;
      const lines = (c.data_lines ?? []).length;
      const used = c.data_used_count ?? 0;
      remaining += Math.max(0, lines - used);
      total += lines;
      if (lines > 0 && lines - used <= LOW_STOCK_THRESHOLD) lowStock = true;
    }
  }
  const label = hasData
    ? `${remaining}/${total}`
    : `${enabled.length} 个池`;
  return { totalCards: enabled.length, label, lowStock };
}

function StatusBadge({ status }: { status: Product['status'] }) {
  const map = {
    draft: { label: '草稿', cls: 'bg-muted text-muted-foreground' },
    active: { label: '在售', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
    archived: { label: '归档', cls: 'bg-muted text-muted-foreground line-through' },
  } as const;
  const cfg = map[status] ?? map.draft;
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', cfg.cls)}>
      {cfg.label}
    </span>
  );
}
