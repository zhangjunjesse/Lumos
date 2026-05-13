'use client';

import * as React from 'react';
import { Tag } from 'lucide-react';

import { useTopTags } from '../use-top-tags';

/**
 * Compact "hot tags" cloud for the Overview page. Shows the top N most-used
 * tags across the library so the user can spot dominant themes at a glance.
 *
 * Hides itself when no tags exist (and stays hidden when only one tag —
 * that's not a "cloud"). Auto-refreshes after a tag rename via the
 * `lumos:douyin-collector:tags-changed` window event subscribed inside
 * `useTopTags`.
 */
export function HotTagsPanel({
  onTagClick,
}: {
  onTagClick?: (tag: string) => void;
} = {}): React.ReactElement | null {
  const { tags: items, loading } = useTopTags(0, 12);

  if (loading || items.length < 2) return null;
  const max = Math.max(...items.map((i) => i.count));

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold tracking-tight">资料库主题分布</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        最常出现的标签 · 字号反映出现频次
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((it) => {
          // Map count to a font-size class. Largest gets text-base, mid
          // text-sm, lowest text-xs. Keep within Tailwind's defaults.
          const ratio = it.count / max;
          const sizeClass =
            ratio >= 0.7 ? 'text-base font-semibold'
              : ratio >= 0.4 ? 'text-sm font-medium'
                : 'text-xs';
          const baseCls = `inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-muted-foreground ${sizeClass}`;
          const inner = (
            <>
              <Tag className="size-3" />
              {it.tag}
              <span className="text-[10px] tabular-nums opacity-60">{it.count}</span>
            </>
          );
          return onTagClick ? (
            <button
              key={it.tag}
              type="button"
              onClick={() => onTagClick(it.tag)}
              className={`${baseCls} cursor-pointer transition-colors hover:bg-foreground/10 hover:text-foreground`}
              title={`点击：在资料库筛选「${it.tag}」（${it.count} 个视频）`}
            >
              {inner}
            </button>
          ) : (
            <span
              key={it.tag}
              className={baseCls}
              title={`${it.tag} · ${it.count} 个视频`}
            >
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}
