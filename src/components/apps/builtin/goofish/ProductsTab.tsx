'use client';

import * as React from 'react';
import { AlertCircle, Loader2, Plus, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { ProductEditor } from './ProductEditor';
import { ProductListItem } from './ProductListItem';
import { XianyuLiveItemsPanel } from './XianyuLiveItemsPanel';
import { useProducts } from './use-products';

type FilterKey = 'all' | 'active' | 'draft' | 'archived';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '在售' },
  { key: 'draft', label: '草稿' },
  { key: 'archived', label: '归档' },
];

export function ProductsTab(): React.ReactElement {
  const { products, loading, error, refresh, create, update, remove } = useProducts();
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [keyword, setKeyword] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const filtered = React.useMemo(() => {
    let list = products;
    if (filter !== 'all') list = list.filter((r) => r.status === filter);
    const q = keyword.trim().toLowerCase();
    if (q) list = list.filter((r) => (r.title || '').toLowerCase().includes(q));
    return list;
  }, [products, filter, keyword]);

  React.useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((cur) => (cur && filtered.some((r) => r.id === cur) ? cur : filtered[0].id));
  }, [filtered]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  const stats = React.useMemo(() => {
    const active = products.filter((r) => r.status === 'active').length;
    const soldToday = products.reduce((sum, r) => sum + (isSoldToday(r.last_sold_at) ? 1 : 0), 0);
    const brokenLinks = products.reduce(
      (sum, r) => sum + (r.links?.filter((l) => l.health === 'broken').length ?? 0),
      0,
    );
    return { active, soldToday, brokenLinks };
  }, [products]);

  return (
    <div className="flex flex-col gap-5">
      <XianyuLiveItemsPanel onLink={() => void refresh()} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">商品库（本地货源）</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {stats.active} 份在售 · 今日卖出 {stats.soldToday} 单
            {stats.brokenLinks > 0 ? ` · ${stats.brokenLinks} 个链接失效` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            刷新
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> 新建商品
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && products.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 加载商品库中…
          </CardContent>
        </Card>
      ) : products.length === 0 && !creating ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
            <span>还没有商品</span>
            <span className="text-xs">点右上「新建商品」上传一份 PDF 并填好夸克链接</span>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <aside className="flex max-h-[75vh] flex-col gap-2 overflow-y-auto rounded-xl border border-border/60 bg-card p-2">
            <input
              type="search"
              placeholder="搜索商品标题…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  variant={filter === f.key ? 'default' : 'outline'}
                  size="xs"
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  {f.key !== 'all' ? (
                    <span className="ml-1 tabular-nums opacity-70">
                      {products.filter((r) => r.status === f.key).length}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
            <ul className="flex flex-col gap-2">
              {filtered.map((product) => (
                <ProductListItem
                  key={product.id}
                  product={product}
                  active={product.id === selectedId}
                  onSelect={() => setSelectedId(product.id)}
                />
              ))}
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  没有匹配的商品
                </li>
              ) : null}
            </ul>
          </aside>

          {creating ? (
            <ProductEditor
              product={null}
              onSave={async (draft) => {
                const row = await create(draft);
                if (row) {
                  setCreating(false);
                  setSelectedId(row.id);
                }
              }}
              onCancel={() => setCreating(false)}
            />
          ) : selected ? (
            <ProductEditor
              product={selected}
              onSave={async (patch) => {
                await update(selected.id, patch);
              }}
              onDelete={async () => {
                await remove(selected.id);
              }}
            />
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed bg-muted/10 text-xs text-muted-foreground">
              选择一件商品查看详情
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function isSoldToday(iso?: string | null): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  const d = new Date(ts);
  const today = new Date();
  return d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
}
