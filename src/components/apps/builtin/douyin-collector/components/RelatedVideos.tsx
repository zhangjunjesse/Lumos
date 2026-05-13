'use client';

import * as React from 'react';
import { Link2 } from 'lucide-react';

import { VideoCover } from './VideoCover';

interface RelatedItem {
  id: string;
  awemeId: string | null;
  title: string | null;
  creatorNickname: string | null;
  cover: string | null;
  durationSeconds: number;
  libraryStatus: string | null;
  sharedTags: string[];
  overlap: number;
}

/**
 * Lazy-fetched list of library videos sharing tags with the given one.
 * Hides itself when there's nothing related to show; doesn't reserve
 * space for an empty section.
 */
export function RelatedVideos({ videoId }: { videoId: string }): React.ReactElement | null {
  const [items, setItems] = React.useState<RelatedItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/apps/builtin/douyin-collector/videos/${videoId}/related`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items: RelatedItem[] };
        if (!cancelled) setItems(json.items ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  if (error) {
    return (
      <p className="text-xs text-rose-500">读取相关视频失败：{error}</p>
    );
  }
  if (items === null) return null;
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-semibold tracking-tight">
        <Link2 className="mr-1 inline size-3" />
        相关视频（共享标签）
      </p>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2 text-xs">
            <VideoCover src={it.cover} size={14} rounded="rounded-md" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {it.title ?? `aweme ${it.awemeId?.slice(0, 8) ?? ''}…`}
              </div>
              <div className="mt-0.5 truncate text-muted-foreground">
                {it.creatorNickname ?? '匿名博主'} · 共享 {it.overlap} 个标签
                {it.sharedTags.length > 0 ? `（${it.sharedTags.slice(0, 3).join(' · ')}）` : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
