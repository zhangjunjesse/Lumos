'use client';

// 单个关注店铺卡:头像 + 基本信息 + EHunt 指标(或未接入) + 装修(banner/整店截图/代表图,点放大)。

import { Trash2, ExternalLink, Store } from 'lucide-react';
import type { Shop } from '../api-types';

function Chip({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded border bg-muted/30 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value ?? '—'}</div>
    </div>
  );
}

// EHunt 区:抓到=显示原文;未接入/失败/采集中=明确状态(不编数)。
function EhuntBlock({ shop }: { shop: Shop }) {
  if (shop.ehunt_status === 'success' && shop.ehunt?.raw) {
    return (
      <div className="rounded border bg-muted/20 p-2">
        <div className="mb-1 text-[10px] font-medium text-muted-foreground">EHunt 店铺指标</div>
        <pre className="whitespace-pre-wrap break-words text-xs leading-snug">{shop.ehunt.raw}</pre>
      </div>
    );
  }
  const text =
    shop.ehunt_status === 'unavailable'
      ? 'EHunt 未接入(店铺页没注入指标)— 已用 Etsy 自带数据'
      : shop.ehunt_status === 'failed'
        ? 'EHunt 采集失败'
        : '采集中…';
  const tone =
    shop.ehunt_status === 'unavailable' ? 'text-amber-600 ring-amber-300' : 'text-muted-foreground ring-border';
  return <div className={`rounded px-2 py-1 text-xs ring-1 ${tone}`}>{text}</div>;
}

function Deco({ url, label, onZoom }: { url: string; label: string; onZoom: (u: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onZoom(url)}
      title={`${label}(点击放大)`}
      className="shrink-0 overflow-hidden rounded border hover:ring-1 hover:ring-foreground"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="size-16 object-cover" />
    </button>
  );
}

export function ShopCard({
  shop,
  onZoom,
  onDelete,
}: {
  shop: Shop;
  onZoom: (url: string) => void;
  onDelete: () => void;
}) {
  const hasDeco = shop.banner || shop.screenshot || shop.rep_listings.length > 0;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        {shop.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shop.avatar_url} alt={shop.shop_name} className="size-12 shrink-0 rounded-full border object-cover" />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <Store className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{shop.shop_name}</span>
            <a
              href={shop.url}
              target="_blank"
              rel="noreferrer"
              title="在 Etsy 打开"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {shop.location ?? '地点未知'} · {shop.product_count} 个关联商品
          </div>
        </div>
        <button type="button" onClick={onDelete} title="删除" className="shrink-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="size-4" />
        </button>
      </div>

      {shop.collect_status === 'failed' && (
        <div className="mt-2 rounded bg-destructive/5 px-2 py-1 text-xs text-destructive">采集失败：{shop.failure_reason ?? '未知'}</div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Chip label="总销量" value={shop.total_sales} />
        <Chip label="评价数" value={shop.review_count} />
        <Chip label="评分" value={shop.review_rating} />
        <Chip label="开店年份" value={shop.since_year} />
      </div>

      <div className="mt-3">
        <EhuntBlock shop={shop} />
      </div>

      {shop.announcement && <p className="mt-3 line-clamp-3 text-xs text-muted-foreground">{shop.announcement}</p>}

      {hasDeco && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-medium text-muted-foreground">装修</div>
          <div className="flex flex-wrap gap-2">
            {shop.banner && <Deco url={shop.banner} label="banner" onZoom={onZoom} />}
            {shop.screenshot && <Deco url={shop.screenshot} label="整店首页" onZoom={onZoom} />}
            {shop.rep_listings.map((u, i) => (
              <Deco key={i} url={u} label={`代表图${i + 1}`} onZoom={onZoom} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
