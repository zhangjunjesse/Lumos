'use client';

// 「继续二创」弹框:针对某原商品,从它已有的图(原印花 + 产品图)里选一张当底图,写一句要求 → 生成新产品图(挂回这个原商品)。

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { etsyForgeApi } from '../api-client';

export interface RemixMoreTarget {
  productId: string;
  title: string | null;
  bases: { url: string; label: string }[]; // 可选底图(原印花/各产品图)
}

export function RemixMoreModal({ target, onClose, onStarted }: { target: RemixMoreTarget; onClose: () => void; onStarted: () => void }) {
  const [baseUrl, setBaseUrl] = useState(target.bases[0]?.url ?? '');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!baseUrl || !instruction.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await etsyForgeApi.remixMore(target.productId, baseUrl, instruction.trim());
      onStarted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="line-clamp-1 text-sm font-medium" title={target.title ?? ''}>继续二创 · {target.title || '该商品'}</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">1 选一张底图(基于它改)</p>
            <div className="flex flex-wrap gap-2">
              {target.bases.map((b) => (
                <button
                  key={b.url}
                  type="button"
                  onClick={() => setBaseUrl(b.url)}
                  title={b.label}
                  className={`relative size-16 overflow-hidden rounded-md border ${baseUrl === b.url ? 'ring-2 ring-foreground' : 'hover:ring-1 hover:ring-foreground'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.url} alt={b.label} className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[8px] text-white">{b.label}</span>
                </button>
              ))}
              {target.bases.length === 0 && <p className="text-xs text-muted-foreground">这个商品还没有可用的图。</p>}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">2 写你的要求</p>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              placeholder="例如:换成蓝色调 / 更复古做旧 / 把兔子换成猫 / 加点星星点缀…"
              className="w-full rounded-md border border-input bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {error && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex items-center gap-2 border-t px-4 py-3">
          <Button disabled={busy || !baseUrl || !instruction.trim()} onClick={() => void go()}>
            {busy ? '发起中…' : '生成'}
          </Button>
          <span className="text-xs text-muted-foreground">生成后挂到这个商品下,后台跑、稍等出现在它这一行。</span>
        </div>
      </div>
    </div>
  );
}
