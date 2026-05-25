'use client';

import * as React from 'react';
import { Copy, ExternalLink, Loader2, Sparkles, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { ProductListingComposeDialog } from './ProductListingComposeDialog';
import { nativeActionUrl } from './use-goofish-app-data';
import type { ProductListing } from './use-product-listings';
import type { Product } from './use-products';

export function ProductListingCard({
  listing,
  product,
  onPatch,
  onRemove,
}: {
  listing: ProductListing;
  product: Product | null;
  onPatch: (p: Partial<ProductListing>) => void;
  onRemove: () => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState<'copy' | 'publish' | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState<{
    title: string;
    description: string;
    price: number;
    images: string[];
  } | null>(null);

  const publishNow = async () => {
    if (typeof window !== 'undefined'
      && !window.confirm(`确认通过「号 ${listing.account_label || listing.account_unb}」一键发布到闲鱼？\n会真的在该账号挂出商品，确认价格 ￥${listing.listed_price ?? 0} 和标题。`)) {
      return;
    }
    onPatch({ publish_status: 'pending', last_publish_error: '' });
    setBusy('publish');
    try {
      const res = await fetch(nativeActionUrl('goofish', 'publish-product-to-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: listing.product_id,
          accountUnb: listing.account_unb,
          listingId: listing.id,
          price: listing.listed_price,
          title: listing.item_title || product?.title,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        itemId?: string;
        itemUrl?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.message ?? '一键发布失败');
      if (typeof window !== 'undefined') {
        window.alert(`已发到闲鱼 ✓\n商品 ID: ${json.itemId}${json.itemUrl ? `\n链接: ${json.itemUrl}` : ''}`);
      }
      onPatch({ item_id: json.itemId, status: 'live' });
    } catch (err) {
      if (typeof window !== 'undefined') {
        const msg = err instanceof Error ? err.message : '一键发布失败';
        window.alert(`${msg}\n\n提示：如果是 cookies 失效，请到概况页重新登录；如果是闲鱼风控/类目识别失败，可以改用「复制商品文案」走手动 APP 上架。`);
      }
    } finally {
      setBusy(null);
    }
  };

  const copyContent = async () => {
    setBusy('copy');
    try {
      const res = await fetch(nativeActionUrl('goofish', 'compose-listing-text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: listing.product_id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        title?: string;
        description?: string;
        price?: number;
        message?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.message ?? '生成文案失败');
      setPreviewOpen({
        title: json.title ?? listing.item_title ?? product?.title ?? '',
        description: json.description ?? product?.summary ?? '',
        price: json.price ?? listing.listed_price ?? 0,
        images: product?.preview_image_paths ?? [],
      });
    } catch (err) {
      if (typeof window !== 'undefined') {
        window.alert(err instanceof Error ? err.message : '复制失败');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            号 {listing.account_label || listing.account_unb}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {listing.item_title || product?.title || '未填标题'} · ￥{listing.listed_price ?? 0}
            {listing.sold_count ? ` · 卖出 ${listing.sold_count} 单` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PublishBadge listing={listing} />
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
            {listing.status === 'live' ? '在售' : listing.status === 'removed' ? '下架' : '售罄'}
          </span>
        </div>
      </header>

      {listing.publish_status === 'failed' && listing.last_publish_error ? (
        <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          上次发布失败：{listing.last_publish_error}
        </p>
      ) : null}

      {!listing.item_id ? (
        <ItemIdInput
          initial={listing.item_id ?? ''}
          onSubmit={(itemId) => onPatch({ item_id: itemId })}
        />
      ) : (
        <p className="text-[10px] text-muted-foreground">
          商品 ID: <code className="rounded bg-muted px-1 py-0.5 font-mono">{listing.item_id}</code>
          <button
            type="button"
            onClick={() => onPatch({ item_id: '' })}
            className="ml-2 text-[10px] text-muted-foreground underline hover:text-foreground"
          >修改</button>
        </p>
      )}

      <footer className="flex items-center justify-end gap-1">
        {!listing.item_id || listing.publish_status === 'failed' ? (
          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={publishNow}
            disabled={busy !== null}
            title="调闲鱼 API 直接挂出商品，省去手动 APP 操作"
          >
            {busy === 'publish' ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            {listing.publish_status === 'failed' ? '重试发布' : '一键发布'}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="xs" onClick={copyContent} disabled={busy !== null}>
          {busy === 'copy' ? <Loader2 className="size-3 animate-spin" /> : <Copy className="size-3" />}
          复制文案
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title="闲鱼发布只能在手机 APP 内完成；网页版只能浏览。可以扫码登录后用手机端发布。"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.open('https://www.goofish.com/', '_blank', 'noopener,noreferrer');
            }
          }}
        >
          <ExternalLink className="size-3" /> 打开闲鱼
        </Button>
        <Button type="button" variant="ghost" size="xs" onClick={onRemove}>
          <Trash2 className="size-3" />
        </Button>
      </footer>
      {previewOpen ? (
        <ProductListingComposeDialog
          {...previewOpen}
          onClose={() => setPreviewOpen(null)}
        />
      ) : null}
    </li>
  );
}

function PublishBadge({ listing }: { listing: ProductListing }): React.ReactElement | null {
  if (listing.publish_status === 'pending') {
    return (
      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-700 dark:text-blue-300">
        发布中…
      </span>
    );
  }
  if (listing.publish_status === 'failed') {
    return (
      <span
        className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive"
        title={listing.last_publish_error || '发布失败'}
      >
        发布失败
      </span>
    );
  }
  if (listing.publish_status === 'success' && listing.item_id) {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
        已发布
      </span>
    );
  }
  return null;
}

function ItemIdInput({
  initial,
  onSubmit,
}: {
  initial: string;
  onSubmit: (itemId: string) => void;
}): React.ReactElement {
  const [value, setValue] = React.useState(initial);
  React.useEffect(() => setValue(initial), [initial]);
  const commit = () => {
    const cleaned = value.replace(/\D/g, '');
    if (!cleaned) return;
    if (cleaned.length < 8 || cleaned.length > 20) {
      if (typeof window !== 'undefined') window.alert('闲鱼商品 ID 应该是 8-20 位数字，请检查后再保存。');
      return;
    }
    onSubmit(cleaned);
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        placeholder="粘贴闲鱼商品 ID（10-16 位纯数字，如 800123456789）"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className="text-xs"
      />
    </div>
  );
}
