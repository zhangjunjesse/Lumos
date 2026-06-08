'use client';

// 我关注的店铺:一键出品「采集店铺」步把商品对应店铺收进来(去重)。看头像/基本信息/EHunt/装修。

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { etsyForgeApi, type Shop } from '../api-client';
import { ShopCard } from './ShopCard';

export function ShopsTab(): React.ReactElement {
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState<string | null>(null);
  const [recollectingId, setRecollectingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await etsyForgeApi.listShops();
      setShops(r.shops);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm('删除这家店铺记录?')) return;
    await etsyForgeApi.deleteShop(id).catch(() => {});
    setShops((s) => s.filter((x) => x.id !== id));
  };

  const recollect = async (id: string) => {
    setRecollectingId(id);
    try {
      await etsyForgeApi.recollectShop(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecollectingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          一键出品时自动采集商品对应店铺(失败不挡出图)。共 {shops.length} 家。
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
        >
          <RefreshCw className="size-3" /> 刷新
        </button>
      </div>

      {error && <div className="rounded bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

      {loading && shops.length === 0 ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : shops.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          还没有店铺。去「我的产品 / 采集任务」跑一次一键出品,「采集店铺」步会把商品对应的店铺收进来。
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shops.map((s) => (
            <ShopCard
              key={s.id}
              shop={s}
              onZoom={setZoom}
              onDelete={() => void remove(s.id)}
              onRecollect={() => void recollect(s.id)}
              recollecting={recollectingId === s.id}
            />
          ))}
        </div>
      )}

      {zoom && (
        <div
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          role="button"
          tabIndex={0}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="放大" className="max-h-full max-w-full rounded object-contain" />
        </div>
      )}
    </div>
  );
}
