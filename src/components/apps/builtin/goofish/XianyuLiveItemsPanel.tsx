'use client';

import * as React from 'react';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Sparkles } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useGoofishAuth } from '@/components/goofish/use-goofish-auth';

import { XianyuItemRefreshDialog } from './XianyuItemRefreshDialog';
import { useXianyuItems, type XianyuItem } from './use-xianyu-items';
import { useProducts } from './use-products';

/**
 * 「闲鱼在售」面板：从闲鱼账号自动拉商品列表，展示 + 让用户反向关联到本地货源。
 */
export function XianyuLiveItemsPanel({
  onLink,
}: {
  /** 已关联到本地产品后的回调（让父组件刷新视图） */
  onLink?: (itemId: string, productId: string) => void;
}): React.ReactElement {
  const { status } = useGoofishAuth();
  const accounts = (status?.accounts ?? []).filter((a) => a.valid);
  const [accountUnb, setAccountUnb] = React.useState(accounts[0]?.accountUnb ?? '');
  React.useEffect(() => {
    if (accounts.length > 0 && !accountUnb) {
      setAccountUnb(accounts[0].accountUnb);
    }
  }, [accounts, accountUnb]);

  const { items, loading, syncing, error, syncFromXianyu, linkToProduct, refreshItem } = useXianyuItems(accountUnb || undefined);
  const { products } = useProducts();
  const [browserContextId, setBrowserContextId] = React.useState('embedded:default');
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [refreshing, setRefreshing] = React.useState<XianyuItem | null>(null);

  const doSync = async () => {
    if (!accountUnb) {
      setFeedback({ kind: 'error', text: '请先选择已登录的闲鱼账号' });
      return;
    }
    setFeedback(null);
    const r = await syncFromXianyu({ accountUnb, browserContextId });
    setFeedback({ kind: r.ok ? 'ok' : 'error', text: r.message });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">闲鱼在售（{items.length}）</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              从你账号自动拉，跟「商品库」是两个东西：在售=平台上挂着的真实商品，商品库=本地货源。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={accountUnb}
              onChange={(e) => setAccountUnb(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              disabled={syncing}
            >
              {accounts.length === 0 ? (
                <option value="">（没有登录账号）</option>
              ) : (
                accounts.map((a) => (
                  <option key={a.accountUnb} value={a.accountUnb}>
                    {a.nick || a.tracknick || a.accountUnb}
                  </option>
                ))
              )}
            </select>
            <select
              value={browserContextId}
              onChange={(e) => setBrowserContextId(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              disabled={syncing}
              title="用哪个浏览器跑（要跟登录时的一致，才有登录态）"
            >
              <option value="embedded:default">内置浏览器</option>
              <option value="adspower:k1ck97si">AdsPower · 内地</option>
            </select>
            <Button size="sm" onClick={() => void doSync()} disabled={syncing || !accountUnb}>
              {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {syncing ? '同步中…' : '从闲鱼拉'}
            </Button>
          </div>
        </header>

        {feedback ? (
          <Alert variant={feedback.kind === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> 加载中…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center text-xs text-muted-foreground">
            <span>还没有同步过商品</span>
            <span>点上方「从闲鱼拉」获取该账号当前在售的商品</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <LiveItemRow
                key={it.id}
                item={it}
                products={products.map((p) => ({ id: p.id, title: p.title }))}
                accountUnb={accountUnb}
                onLink={async (productId) => {
                  const r = await linkToProduct({
                    itemId: it.item_id,
                    productId,
                    accountUnb,
                    itemTitle: it.title,
                    price: it.price,
                  });
                  setFeedback({ kind: r.ok ? 'ok' : 'error', text: r.message });
                  if (r.ok) onLink?.(it.item_id, productId);
                }}
                onRefresh={() => setRefreshing(it)}
              />
            ))}
          </ul>
        )}
      </CardContent>
      {refreshing ? (
        <XianyuItemRefreshDialog
          item={refreshing}
          accountUnb={accountUnb}
          onClose={() => setRefreshing(null)}
          onConfirm={async (opts) => {
            const r = await refreshItem({
              itemId: refreshing.item_id,
              accountUnb,
              ...opts,
            });
            setFeedback({ kind: r.ok ? 'ok' : 'error', text: r.message });
            return r;
          }}
        />
      ) : null}
    </Card>
  );
}

function LiveItemRow({
  item,
  products,
  accountUnb,
  onLink,
  onRefresh,
}: {
  item: XianyuItem;
  products: Array<{ id: string; title: string }>;
  accountUnb: string;
  onLink: (productId: string) => Promise<void>;
  onRefresh: () => void;
}): React.ReactElement {
  const [linking, setLinking] = React.useState(false);
  const [selecting, setSelecting] = React.useState(false);
  const [chosen, setChosen] = React.useState('');

  return (
    <li className="flex items-center gap-3 rounded-lg border p-2.5">
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image_url}
          alt={item.title}
          className="size-12 shrink-0 rounded object-cover"
          loading="lazy"
        />
      ) : (
        <div className="size-12 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title || '未命名'}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          ￥{item.price_text || item.price || '0'}
          {item.shipping_info ? ` · ${item.shipping_info}` : ''}
          {item.want_count ? ` · ${item.want_count} 人想要` : ''}
          {' · '}
          <code className="rounded bg-muted px-1 font-mono">{item.item_id}</code>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={`https://www.goofish.com/item?id=${item.item_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" /> 看
        </a>
        <Button
          size="xs"
          variant="ghost"
          onClick={onRefresh}
          title="AI 优化描述/图片并重新上架（下架重发=同时擦亮）"
          disabled={!accountUnb}
        >
          <Sparkles className="size-3" /> AI 优化
        </Button>
        {item.has_local_product ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3" /> 已关联
          </span>
        ) : selecting ? (
          <div className="flex items-center gap-1">
            <select
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className="h-7 rounded-md border bg-background px-1 text-[11px]"
              disabled={linking}
            >
              <option value="">选本地货源…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.title || p.id.slice(0, 6)}</option>
              ))}
            </select>
            <Button
              size="xs"
              onClick={async () => {
                if (!chosen || !accountUnb) return;
                setLinking(true);
                try { await onLink(chosen); } finally { setLinking(false); }
                setSelecting(false);
              }}
              disabled={linking || !chosen}
            >
              {linking ? <Loader2 className="size-3 animate-spin" /> : '确认'}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setSelecting(false)} disabled={linking}>
              取消
            </Button>
          </div>
        ) : (
          <Button size="xs" variant="outline" onClick={() => setSelecting(true)}>
            关联到本地货源
          </Button>
        )}
      </div>
    </li>
  );
}
