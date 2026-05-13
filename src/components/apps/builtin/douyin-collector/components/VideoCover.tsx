'use client';

import * as React from 'react';
import { ImageOff } from 'lucide-react';

/**
 * Cover thumbnail with lazy loading + onError fallback.
 *
 * Douyin cover URLs are CDN-served and sometimes return 403 (referer
 * check) or 404 (cleared from cache). When that happens we swap to a
 * muted placeholder rather than showing a broken-image icon.
 *
 * Lazy loading matters as the library grows: 300 videos × 16KB cover =
 * ~5MB if loaded eagerly. `loading="lazy"` defers off-screen ones.
 */
export function VideoCover({
  src,
  size = 16,
  rounded = 'rounded-lg',
}: {
  src?: string | null;
  size?: 14 | 16 | 20;
  rounded?: string;
}): React.ReactElement {
  const [failed, setFailed] = React.useState(false);
  const sizeClass = size === 14 ? 'size-14' : size === 20 ? 'size-20' : 'size-16';

  if (!src || failed) {
    return (
      <div
        className={`flex ${sizeClass} shrink-0 items-center justify-center ${rounded} bg-muted text-muted-foreground ring-1 ring-border`}
        aria-label={failed ? '封面加载失败' : '无封面'}
      >
        <ImageOff className="size-4" strokeWidth={1.5} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${sizeClass} shrink-0 ${rounded} object-cover ring-1 ring-border`}
    />
  );
}
