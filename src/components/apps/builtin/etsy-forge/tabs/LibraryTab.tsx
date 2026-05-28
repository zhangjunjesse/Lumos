'use client';

// 图库 tab —— 采集到的详情图（第二步产物）。网格 + 多选下载。

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi, type LibImage } from '../api-client';

export function LibraryTab() {
  const [images, setImages] = useState<LibImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await etsyForgeApi.listLibrary();
      setImages(res.images);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const downloadSelected = () => {
    const targets = selected.size > 0 ? images.filter((i) => selected.has(i.id)) : images;
    for (const img of targets) {
      const a = document.createElement('a');
      a.href = img.url;
      a.download = `${img.listing_id}-${img.position}.jpg`;
      a.target = '_blank';
      a.click();
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {images.length} 张详情图{selected.size > 0 ? ` · 已选 ${selected.size}` : ''}
        </span>
        <div className="flex-1" />
        <Button size="sm" onClick={downloadSelected} disabled={images.length === 0}>
          {selected.size > 0 ? `下载选中 ${selected.size} 张` : '下载全部'}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      {!loading && images.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          图库还是空的。去「商品列表」勾选商品，点「爬选中详情图」把详情图采进来。
        </div>
      )}

      {!loading && images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {images.map((img) => (
            <div
              key={img.id}
              className={`relative aspect-square overflow-hidden rounded-md border ${selected.has(img.id) ? 'border-foreground ring-1 ring-foreground' : 'border-border'}`}
            >
              <button type="button" onClick={() => toggle(img.id)} className="block h-full w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.keyword} className="h-full w-full object-cover" />
                {selected.has(img.id) && (
                  <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded bg-foreground text-xs text-background">
                    ✓
                  </span>
                )}
                {img.is_main && (
                  <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    主图
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
