'use client';

// 「产品开发」tab：在研产品清单(table) → 进详情装配完整 Etsy listing。
// 新建空白 / 从出图组导入。设计真源 docs/etsy-forge-product-development-design.md。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STATUS_LABELS } from '@/lib/etsy-forge/listing/catalog';
import { computeCompleteness } from '@/lib/etsy-forge/listing/completeness';
import { listingApi, type ListingRow } from './develop/listing-api';
import { ListingDetail } from './develop/ListingDetail';
import { ProductImagePicker } from './develop/ProductImagePicker';
import { PhotoJobsDock } from './develop/PhotoJobsDock';

const STATUS_ORDER = ['draft', 'developing', 'ready', 'listed', 'archived'];
const statusCls: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  developing: 'bg-blue-100 text-blue-700',
  ready: 'bg-emerald-100 text-emerald-700',
  listed: 'bg-violet-100 text-violet-700',
  archived: 'bg-muted text-muted-foreground line-through',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function DevelopTab() {
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await listingApi.list();
      setListings(r.listings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    // load 内 await 后才 setState(异步、非同步级联)。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const createBlank = async () => {
    try {
      const r = await listingApi.create({});
      await load();
      setSelectedId(r.listing.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const createFromImage = async (mockupId: string, title: string) => {
    setPicking(false);
    try {
      const r = await listingApi.create({ mockupId, name: title });
      await load();
      setSelectedId(r.listing.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = async (id: string) => {
    if (!confirm('删除这个在研产品？')) return;
    await listingApi.remove(id).catch(() => {});
    await load();
  };

  const visible = useMemo(() => (filter ? listings.filter((l) => l.status === filter) : listings), [listings, filter]);
  const selected = selectedId ? listings.find((l) => l.id === selectedId) ?? null : null;

  if (selected) {
    return (
      <div className="mx-auto max-w-6xl">
        <ListingDetail
          initial={selected}
          onBack={() => {
            setSelectedId(null);
            void load();
          }}
        />
        <PhotoJobsDock />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium">在研产品（{listings.length}）</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          <option value="">全部状态</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setPicking(true)}>从产品图新建</Button>
        <Button size="sm" onClick={() => void createBlank()}><Plus className="size-4" />新建空白产品</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          还没有在研产品。点「新建空白产品」从零开始，或「从产品图新建」挑一张已出图的产品图来装配上架信息。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">主图</th>
                <th className="px-3 py-2 text-left">产品名 / 标题</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-left">完整度</th>
                <th className="px-3 py-2 text-left">图</th>
                <th className="px-3 py-2 text-left">变体</th>
                <th className="px-3 py-2 text-left">价格</th>
                <th className="px-3 py-2 text-left">更新</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const c = computeCompleteness(l);
                const main = (l.photos || []).find((p) => p.isMain) || (l.photos || [])[0] || null;
                return (
                  <tr key={l.id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => setSelectedId(l.id)}>
                    <td className="px-3 py-2">
                      {main ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={main.src} alt="" loading="lazy" decoding="async" className="size-10 rounded border object-cover" />
                      ) : (
                        <div className="size-10 rounded border bg-muted" />
                      )}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2">{l.title || l.internal_name}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusCls[l.status] ?? ''}`}>{STATUS_LABELS[l.status]}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-500" style={{ width: `${c.percent}%` }} /></div>
                        <span className="text-xs text-muted-foreground">{c.percent}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{(l.photos || []).length}</td>
                    <td className="px-3 py-2 text-muted-foreground">{l.variations?.combos?.length || 0}</td>
                    <td className="px-3 py-2 text-muted-foreground">{l.price ? `${l.currency} ${l.price}` : '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtTime(l.updated_at)}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={(e) => { e.stopPropagation(); void remove(l.id); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProductImagePicker open={picking} onClose={() => setPicking(false)} onPick={(mockupId, title) => void createFromImage(mockupId, title)} />
      <PhotoJobsDock />
    </div>
  );
}
