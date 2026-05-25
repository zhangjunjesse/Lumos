'use client';

import * as React from 'react';
import type { EhuntListing } from '../etsy-erank-types';

// "https://www.etsy.com/listing/4438429970/slug?click_key=..." → "https://www.etsy.com/listing/4438429970/slug"
function cleanListingUrl(href: string): string {
  if (!href) return '';
  const i = href.indexOf('?');
  return i === -1 ? href : href.slice(0, i);
}

// shop_name → "https://www.etsy.com/shop/<shop_name>"
function shopUrl(shopName: string): string {
  if (!shopName) return '';
  return `https://www.etsy.com/shop/${encodeURIComponent(shopName.trim())}`;
}

export function ListingLightbox({
  listing,
  onClose,
}: {
  listing: EhuntListing | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState<'listing' | 'shop' | null>(null);

  // Esc 关闭
  React.useEffect(() => {
    if (!listing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [listing, onClose]);

  if (!listing) return null;

  const productUrl = cleanListingUrl(listing.href);
  const shop = listing.shop_name?.trim();
  const shopHref = shop ? shopUrl(shop) : '';

  async function copyText(text: string, kind: 'listing' | 'shop') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // 兜底:用 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(kind);
        setTimeout(() => setCopied(null), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭 */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-background/80 px-3 py-1 text-sm font-medium ring-1 ring-border hover:bg-muted"
          title="关闭 (Esc)"
        >
          ✕
        </button>

        <div className="grid gap-4 md:grid-cols-2">
          {/* 左:大图 */}
          <div className="flex items-center justify-center bg-muted/30 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={listing.img}
              alt={listing.title}
              className="max-h-[80vh] w-auto rounded object-contain"
            />
          </div>

          {/* 右:信息 + 操作 */}
          <div className="flex flex-col gap-3 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">标题</div>
              <div className="mt-0.5 text-sm leading-relaxed">{listing.title}</div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Box label="价格" value={listing.price || '—'} />
              <Box label="店铺" value={shop || '—'} sub={listing.shop_rating != null ? `★ ${listing.shop_rating} · ${listing.shop_review_count ?? 0} 评价` : ''} />
              <Box label="累计销量" value={listing.ehunt.sales != null ? String(listing.ehunt.sales) : '—'} />
              <Box label="收藏" value={listing.ehunt.favorites != null ? String(listing.ehunt.favorites) : '—'} />
              <Box label="店铺周销" value={listing.ehunt.store_weekly_sales != null ? String(listing.ehunt.store_weekly_sales) : '—'} />
              <Box label="上架日期" value={listing.ehunt.listed_date || '—'} />
            </div>

            {/* 商品链接 */}
            {productUrl && (
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">商品链接</div>
                <div className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] break-all">
                  {productUrl}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(productUrl, 'listing')}
                    className="flex-1 rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
                  >
                    {copied === 'listing' ? '已复制 ✓' : '复制商品链接'}
                  </button>
                  <a
                    href={productUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded px-3 py-1.5 text-xs ring-1 ring-border hover:bg-muted"
                  >
                    跳 Etsy →
                  </a>
                </div>
              </div>
            )}

            {/* 店铺链接 */}
            {shopHref && (
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">店铺链接</div>
                <div className="rounded border border-border bg-muted/30 px-2 py-1 text-[10px] break-all">
                  {shopHref}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(shopHref, 'shop')}
                    className="flex-1 rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
                  >
                    {copied === 'shop' ? '已复制 ✓' : '复制店铺链接'}
                  </button>
                  <a
                    href={shopHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded px-3 py-1.5 text-xs ring-1 ring-border hover:bg-muted"
                  >
                    跳店铺 →
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Box({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
