'use client';

// 图库大图查看器：全屏遮罩 + 大图，支持左右切换、Esc/点空白/× 关闭。

import { useCallback, useEffect } from 'react';

export interface LightboxImage {
  url: string;
  title?: string;
}

export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const count = images.length;
  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      onIndexChange((index + delta + count) % count);
    },
    [index, count, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const current = images[index];
  if (!current) return null;

  const navBtn =
    'absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20';

  // 下载当前图:抓成 blob 再存,远程图(跨域)也能强制下载、不会变成新开网页。
  const download = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      a.download = (url.split('/').pop()?.split('?')[0] || 'image') + (blob.type.includes('png') ? '.png' : '.jpg');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
    } catch {
      window.open(url, '_blank'); // 兜底:抓不到就新开
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void download(current.url);
        }}
        aria-label="下载"
        title="下载这张"
        className="absolute right-16 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-lg text-white hover:bg-white/20"
      >
        ⬇
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-lg text-white hover:bg-white/20"
      >
        ✕
      </button>
      {count > 1 && (
        <button
          type="button"
          aria-label="上一张"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          className={`${navBtn} left-4`}
        >
          ‹
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.url}
        alt={current.title ?? ''}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded object-contain"
      />
      {count > 1 && (
        <button
          type="button"
          aria-label="下一张"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          className={`${navBtn} right-4`}
        >
          ›
        </button>
      )}
      {count > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/50 px-3 py-1 text-xs text-white">
          {index + 1} / {count}
        </div>
      )}
    </div>
  );
}
