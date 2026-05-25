'use client';

import * as React from 'react';
import type { EhuntKeywordData, EhuntListing } from '../etsy-erank-types';
import { ListingLightbox } from './ListingLightbox';

function fmt(n: number | null | undefined, suffix = '') {
  if (n == null) return '—';
  if (n >= 1000) return Math.round(n).toLocaleString() + suffix;
  if (Number.isInteger(n)) return n + suffix;
  return n.toFixed(2) + suffix;
}

function ageBucket(days: number): string {
  if (days <= 30) return '≤30 天';
  if (days <= 90) return '≤90 天';
  if (days <= 180) return '≤6 月';
  if (days <= 365) return '≤1 年';
  return '> 1 年';
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
}

export function EhuntDeepPanel({ data }: { data: EhuntKeywordData | undefined; runId?: string; keyword?: string }) {
  const [active, setActive] = React.useState<EhuntListing | null>(null);
  const [copiedShop, setCopiedShop] = React.useState<string | null>(null);

  const copyShopUrl = React.useCallback(async (name: string) => {
    const url = `https://www.etsy.com/shop/${encodeURIComponent(name.trim())}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopiedShop(name);
      setTimeout(() => setCopiedShop((cur) => (cur === name ? null : cur)), 1500);
    }
  }, []);

  if (!data) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        该关键词暂无 ⑥ 商业分析数据(可能尚未抓取或未通过 EHunt 注入)。
      </div>
    );
  }
  const { analysis: a, listings } = data;

  // 上架天数分桶
  const ageHistogram: Record<string, number> = {};
  a.newStores.ageDistribution.forEach((d) => {
    const b = ageBucket(d);
    ageHistogram[b] = (ageHistogram[b] || 0) + 1;
  });

  return (
    <div className="space-y-4 rounded border border-border bg-card p-4">
      {/* LLM 一句话定调 */}
      <div className="rounded border border-amber-500/30 bg-amber-50/50 p-3 text-sm leading-relaxed dark:bg-amber-950/20">
        <div className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">LLM 切入建议</div>
        <div className="text-foreground">{a.llmInsight}</div>
      </div>

      {/* 关键数字 4 列 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatBlock label="销量(顶/中位)" value={`${fmt(a.sales.max)} / ${fmt(a.sales.median)}`} sub={`top10 合计 ${a.sales.top10.reduce((s, x) => s + x, 0)}`} />
        <StatBlock label="收藏(顶/中位)" value={`${fmt(a.favorites.max)} / ${fmt(a.favorites.median)}`} sub={`合计 ${fmt(a.favorites.total)}`} />
        <StatBlock label="价格中位 / 25-75 区间" value={`$${fmt(a.price.median)}`} sub={`$${fmt(a.price.p25)} - $${fmt(a.price.p75)}`} />
        <StatBlock label="头部 5 店占销量" value={`${Math.round(a.top5SalesPct * 100)}%`} sub={`${a.newStores.within30} 个新店 ≤30 天 · ${a.newStores.within30WithSales} 已出单`} />
      </div>

      {/* 主图 9 宫格(取 top 9) — 点击查看大图 + 复制链接 */}
      <div>
        <div className="mb-2 text-xs font-semibold text-muted-foreground">头部 9 个 listing(按搜索排名,点击看大图)</div>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-9">
          {listings.slice(0, 9).map((l) => (
            <button
              key={l.listing_id}
              type="button"
              onClick={() => setActive(l)}
              className="group relative aspect-square overflow-hidden rounded border border-border hover:border-foreground/40"
              title={`${l.title} · 销 ${l.ehunt.sales ?? '?'} · 收藏 ${l.ehunt.favorites ?? '?'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.img} alt={l.title} className="h-full w-full object-cover" />
              {l.ehunt.sales != null && l.ehunt.sales > 0 && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
                  销 {l.ehunt.sales}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 头部店铺 + 上架时间分布 + SEO */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* 头部 5 店 — 点击复制店铺 URL */}
        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">头部 5 店(按销量,点击复制店铺 URL)</div>
          <div className="space-y-1">
            {a.topShops.slice(0, 5).map((s, i) => (
              <button
                key={s.name}
                type="button"
                onClick={() => copyShopUrl(s.name)}
                className="flex w-full items-baseline justify-between rounded px-1 -mx-1 text-left text-xs hover:bg-muted/50"
                title={`点击复制 https://www.etsy.com/shop/${s.name}`}
              >
                <span className="truncate">
                  <span className="text-muted-foreground">{i + 1}.</span>{' '}
                  <span className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid">
                    {s.name}
                  </span>
                  {copiedShop === s.name && (
                    <span className="ml-2 text-[10px] text-emerald-700">已复制 ✓</span>
                  )}
                </span>
                <span className="ml-2 whitespace-nowrap font-mono tabular-nums text-muted-foreground">
                  销 {s.sales} · {s.listings} listing
                </span>
              </button>
            ))}
            {a.topShops.length === 0 && <div className="text-xs text-muted-foreground">无</div>}
          </div>
        </div>

        {/* 上架时间分布 */}
        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">上架时间分布</div>
          <div className="space-y-1">
            {['≤30 天', '≤90 天', '≤6 月', '≤1 年', '> 1 年'].map((b) => {
              const n = ageHistogram[b] || 0;
              const max = Math.max(1, ...Object.values(ageHistogram));
              const pct = (n / max) * 100;
              return (
                <div key={b} className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-muted-foreground">{b}</span>
                  <div className="relative h-3 flex-1 rounded bg-muted">
                    <div className="h-full rounded bg-sky-500/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-6 text-right font-mono tabular-nums">{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* SEO 头部词 */}
        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">头部 SEO 词(≥30% listing 含)</div>
          <div className="flex flex-wrap gap-1">
            {a.topNgrams.slice(0, 13).map((n) => (
              <span
                key={n.gram}
                className="rounded bg-muted px-1.5 py-0.5 text-xs"
                title={`${n.count} listing · ${Math.round(n.pct * 100)}%`}
              >
                {n.gram}
              </span>
            ))}
            {a.topNgrams.length === 0 && <div className="text-xs text-muted-foreground">无明显高频词</div>}
          </div>
        </div>
      </div>

      {/* 完整 24 listing 折叠 — 点击看大图 + 复制链接 */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          展开全部 {listings.length} 个 listing
        </summary>
        <div className="mt-2 space-y-1">
          {listings.map((l) => (
            <button
              key={l.listing_id}
              type="button"
              onClick={() => setActive(l)}
              className="flex w-full items-center gap-2 rounded border border-border p-1.5 text-left hover:border-foreground/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.img} alt="" className="h-10 w-10 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{l.title}</div>
                <div className="text-[10px] text-muted-foreground">
                  {l.price} · {l.shop_name || '?'} · ★ {l.shop_rating ?? '?'} ({l.shop_review_count ?? 0})
                </div>
              </div>
              <div className="whitespace-nowrap text-right font-mono text-[10px] tabular-nums">
                <div>销 {l.ehunt.sales ?? '?'} · ♥ {l.ehunt.favorites ?? '?'}</div>
                <div className="text-muted-foreground">{l.ehunt.listed_date ?? '?'}</div>
              </div>
            </button>
          ))}
        </div>
      </details>

      <ListingLightbox listing={active} onClose={() => setActive(null)} />
    </div>
  );
}

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
