'use client';

// 单个关注店铺卡:头像 + 基本信息 + EHunt 指标(或未接入) + 装修(banner/整店截图/代表图,点放大)。

import { Trash2, ExternalLink, Store, RefreshCw, Loader2 } from 'lucide-react';
import type { Shop } from '../api-types';

function Chip({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded border bg-muted/30 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value ?? '—'}</div>
    </div>
  );
}

// EHunt 原始文本解析成字段(中英兼容);识别不出就整段保留。
function parseEhuntBar(raw: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const sales = raw.match(/(?:total sales|sales|总销量|销量)[:：\s]*([\d,]+)\s*(?:\(([\d,]+)\))?/i);
  if (sales) out.push({ label: 'Sales', value: sales[1] + (sales[2] ? `(${sales[2]})` : '') });
  const fav = raw.match(/(?:favorit[a-z]*|收藏量?)[:：\s]*([\d.,]+\s*[kKmM]?)/i);
  if (fav) out.push({ label: 'Favorites', value: fav[1].trim() });
  const weekly = raw.match(/(?:store\s*)?weekly sales[:：\s]*([\d,]+)/i) ?? raw.match(/周销量?[:：\s]*([\d,]+)/);
  if (weekly) out.push({ label: '周销', value: weekly[1] });
  const listed = raw.match(/(?:listed|上架(?:日期|时间)?)[:：\s]*([\d/.\-]+)/i);
  if (listed) out.push({ label: '上架', value: listed[1] });
  return out;
}

// EHunt 区:优先展示注入的原始长 bar 截图(用户要的就是这条长图);没截到才退回解析文本;再没有=明确状态(不编)。
function EhuntBlock({ shop, onZoom }: { shop: Shop; onZoom: (u: string) => void }) {
  if (shop.ehunt_bar) {
    return (
      <button
        type="button"
        onClick={() => onZoom(shop.ehunt_bar as string)}
        title="EHunt 店铺 bar(点击放大)"
        className="block w-full overflow-hidden rounded border hover:ring-1 hover:ring-foreground"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shop.ehunt_bar} alt="EHunt 店铺指标" className="w-full object-contain" />
      </button>
    );
  }
  const raw = shop.ehunt_status === 'success' ? shop.ehunt?.raw ?? '' : '';
  if (raw) {
    const fields = parseEhuntBar(raw);
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-neutral-900 px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-lime-400/60">EHunt</span>
        {fields.length > 0 ? (
          fields.map((f) => (
            <span key={f.label} className="text-sm text-lime-400">
              <span className="text-lime-400/60">{f.label} </span>
              <span className="font-semibold tabular-nums">{f.value}</span>
            </span>
          ))
        ) : (
          <span className="text-sm text-lime-400">{raw}</span>
        )}
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
  onRecollect,
  recollecting,
}: {
  shop: Shop;
  onZoom: (url: string) => void;
  onDelete: () => void;
  onRecollect: () => void;
  recollecting: boolean;
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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRecollect}
            disabled={recollecting}
            title="重新采集这家店(刷新基本信息/装修/EHunt bar)"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {recollecting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </button>
          <button type="button" onClick={onDelete} title="删除" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {recollecting && <div className="mt-2 rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground">重采中…开浏览器抓店铺页,约 10–20 秒</div>}

      {shop.collect_status === 'failed' && (
        <div className="mt-2 rounded bg-destructive/5 px-2 py-1 text-xs text-destructive">采集失败：{shop.failure_reason ?? '未知'}</div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Chip label="总销量" value={shop.total_sales} />
        <Chip label="评价数" value={shop.review_count} />
        <Chip label="评分" value={shop.review_rating} />
        <Chip label="开店时长" value={shop.since_year} />
      </div>

      <div className="mt-3">
        <EhuntBlock shop={shop} onZoom={onZoom} />
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
