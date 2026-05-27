'use client';

// 我的图库 — 网格视图 + tab 过滤 + 多选 + 批量下载/删除
// 单击图片进入详情/二创页

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { etsyForgeApi, type LibraryImage } from './api-client';

type Tab = 'all' | 'generated' | 'remixed';

export function LibraryView() {
  const [tab, setTab] = useState<Tab>('all');
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await etsyForgeApi.library(tab);
      setImages(res.images);
      setTotal(res.total);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onBatchDownload = async () => {
    if (selected.size === 0) return;
    try {
      const res = await etsyForgeApi.exportDownload([...selected]);
      // 浏览器逐个触发下载
      for (const item of res.items) {
        const a = document.createElement('a');
        a.href = item.url;
        a.download = item.filename;
        a.click();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onBatchDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`确认从图库删除 ${selected.size} 张图？文件本身不会删除。`)) return;
    for (const id of selected) {
      try {
        await etsyForgeApi.deleteImage(id);
      } catch {
        // 单张失败不阻塞批量
      }
    }
    void load();
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-medium">我的图库</h1>
            <p className="text-xs text-zinc-500">{total} 张</p>
          </div>
          <Link
            href="/apps/etsy-forge"
            className="rounded-md border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            返回刷图
          </Link>
        </div>
        <div className="mt-4 flex items-center gap-2">
          {(['all', 'generated', 'remixed'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md border px-3 py-1 text-xs ${
                tab === t
                  ? 'border-zinc-100 bg-zinc-100 text-zinc-900'
                  : 'border-zinc-700 text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              {t === 'all' ? '全部' : t === 'generated' ? '仅原图' : '仅二创'}
            </button>
          ))}
          <div className="flex-1" />
          {selected.size > 0 && (
            <>
              <span className="text-xs text-zinc-400">已选 {selected.size}</span>
              <button
                onClick={onBatchDownload}
                className="rounded-md bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900"
              >
                打包下载
              </button>
              <button
                onClick={onBatchDelete}
                className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                删除
              </button>
            </>
          )}
        </div>
      </header>

      <main className="px-6 py-6">
        {loading && <p className="text-sm text-zinc-400">加载中…</p>}
        {error && <p className="text-sm text-red-400">出错：{error}</p>}
        {!loading && !error && images.length === 0 && (
          <div className="rounded-md border border-zinc-800 p-12 text-center">
            <p className="mb-3 text-sm text-zinc-300">图库还是空的</p>
            <p className="mb-6 text-xs text-zinc-500">
              在刷图界面点 👍 把喜欢的图收藏进来；在详情页可以继续 AI 二创衍生新设计。
            </p>
            <Link
              href="/apps/etsy-forge"
              className="inline-block rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900"
            >
              去刷图
            </Link>
          </div>
        )}
        {!loading && images.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {images.map((img) => (
              <ImageCard
                key={img.id}
                image={img}
                selected={selected.has(img.id)}
                onToggle={() => toggleSelect(img.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ImageCard({
  image,
  selected,
  onToggle,
}: {
  image: LibraryImage;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`group relative aspect-square overflow-hidden rounded-md border ${
        selected ? 'border-zinc-100' : 'border-zinc-800'
      }`}
    >
      <Link href={`/apps/etsy-forge/library/${encodeURIComponent(image.id)}`} className="block h-full w-full">
        <img src={image.url} alt={image.theme} className="h-full w-full object-cover" draggable={false} />
      </Link>
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-100">
        {image.source_type === 'remixed' ? `二创·${image.remix_action ?? ''}` : '原图'}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-label={selected ? '取消选中' : '选中'}
        className={`absolute bottom-2 left-2 h-5 w-5 rounded border ${
          selected ? 'border-zinc-100 bg-zinc-100 text-zinc-900' : 'border-zinc-600 bg-black/40 text-transparent'
        } text-xs leading-none`}
      >
        {selected ? '✓' : ''}
      </button>
    </div>
  );
}
