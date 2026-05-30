'use client';

// 抠图结果弹框：列出该商品每张图的「原图 → 抠图」对比。失败的显示原因。

import { useCallback, useEffect, useState } from 'react';
import { etsyForgeApi, type Cutout } from '../api-client';

export function CutoutModal({
  productId,
  title,
  onClose,
}: {
  productId: string;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [cutouts, setCutouts] = useState<Cutout[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await etsyForgeApi.listCutouts(productId);
      setCutouts(r.cutouts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const okCount = cutouts.filter((c) => c.status === 'success').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <h2 className="flex-1 truncate text-sm font-medium">抠图结果 · {title || '(无标题)'}</h2>
          <span className="text-xs text-muted-foreground">{okCount}/{cutouts.length} 成功</span>
          <button type="button" onClick={onClose} aria-label="关闭" className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-muted-foreground">加载中…</p>}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {!loading && cutouts.length === 0 && !error && (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              这个商品还没抠图。关闭弹框，选中它点「开始抠图」。
            </div>
          )}
          <div className="space-y-3">
            {cutouts.map((c) => (
              <div key={c.id} className="rounded-md border p-3">
                <p className="mb-2 text-[11px] text-muted-foreground">基于该商品 {c.source_count} 张图抠出</p>
                {c.status === 'success' && c.cutout_url ? (
                  // 透明底用棋盘格背景衬托
                  <div
                    className="mx-auto max-w-sm rounded"
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)',
                      backgroundSize: '16px 16px',
                      backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.cutout_url} alt="抠图" className="mx-auto max-h-[50vh] w-full object-contain" />
                  </div>
                ) : (
                  <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-center text-xs text-destructive">
                    {c.failure_reason || '抠图失败'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
