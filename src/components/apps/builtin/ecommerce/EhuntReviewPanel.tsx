'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import type { DiscoverCandidate } from './types';
import type { EhuntMetrics, EtsyReviewBundle, ReviewIntel } from '@/lib/ecommerce-assistant/ehunt/types';

const ENDPOINT = '/api/apps/builtin/ecommerce/ehunt';

interface ListingRef {
  url: string;
  ehunt: EhuntMetrics | null;
}

/** 从候选 sources JSON 取首个 Etsy listing 明细及其 EHunt 指标。无则返回 null。 */
function pickEtsyListing(candidate: DiscoverCandidate): ListingRef | null {
  if (!candidate.sources) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.sources);
  } catch {
    return null;
  }
  const entries = Array.isArray(parsed) ? parsed : [];
  for (const entry of entries) {
    const details = (entry as { details?: unknown }).details;
    if (!Array.isArray(details)) continue;
    for (const d of details) {
      const url = typeof (d as { url?: unknown }).url === 'string' ? (d as { url: string }).url : '';
      if (/etsy\.com\/listing\/\d+/i.test(url)) {
        const ehunt = (d as { ehunt?: EhuntMetrics | null }).ehunt ?? null;
        return { url, ehunt };
      }
    }
  }
  return null;
}

type Phase = 'idle' | 'collecting' | 'analyzing';

function MetricRow({ label, value }: { label: string; value: string | number | null | undefined }): React.ReactElement {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-1 text-[11px] last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value === null || value === undefined || value === '' ? '—' : value}</span>
    </div>
  );
}

function formatMetricCount(value: number | null | undefined): string | null {
  return value == null ? null : `${value.toLocaleString('en-US')} 个`;
}

function Entries({ title, items }: { title: string; items: { topic: string; reason: string }[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold">{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="rounded-md border border-border/60 p-2 text-[11px]">
            <span className="font-medium">{it.topic}</span>
            <span className="text-muted-foreground"> — {it.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EhuntReviewPanel({ candidate }: { candidate: DiscoverCandidate }): React.ReactElement {
  const listing = React.useMemo(() => pickEtsyListing(candidate), [candidate]);
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [bundle, setBundle] = React.useState<EtsyReviewBundle | null>(null);
  const [intel, setIntel] = React.useState<ReviewIntel | null>(null);
  const [intelReason, setIntelReason] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!listing) {
    return <p className="text-[11px] text-muted-foreground">该候选无 Etsy listing，EHunt 功能不可用。</p>;
  }

  const post = async (action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);
    return data;
  };

  const collect = async (): Promise<void> => {
    setPhase('collecting');
    setError(null);
    setIntel(null);
    setIntelReason(null);
    try {
      const data = await post('collect-reviews', { listingUrl: listing.url });
      setBundle((data.bundle as EtsyReviewBundle) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase('idle');
    }
  };

  const analyze = async (): Promise<void> => {
    if (!bundle) return;
    setPhase('analyzing');
    setError(null);
    try {
      const data = await post('analyze-reviews', { bundle });
      setIntel((data.intel as ReviewIntel) ?? null);
      setIntelReason((data.reason as string) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase('idle');
    }
  };

  const m = listing.ehunt;
  const canAnalyze = bundle?.status === 'ok' && bundle.reviews.length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold">EHunt 指标</p>
        {m ? (
          <div className="rounded-md border border-border p-2">
            <MetricRow label="总销量" value={formatMetricCount(m.salesTotal)} />
            <MetricRow label="近期销量" value={formatMetricCount(m.salesRecent)} />
            <MetricRow label="收藏" value={formatMetricCount(m.favorites)} />
            <MetricRow label="店铺周销" value={formatMetricCount(m.storeWeeklySales)} />
            <MetricRow label="上架日期" value={m.listedDate} />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            未接入 EHunt（需在「设置 → 浏览器」选已装 EHunt 的 AdsPower profile，重新采集后显示）。
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={collect} disabled={phase !== 'idle'}>
            {phase === 'collecting' ? '采集中…' : bundle ? '重新采集评论' : '采集评论'}
          </Button>
          <Button size="sm" variant="outline" onClick={analyze} disabled={phase !== 'idle' || !canAnalyze}>
            {phase === 'analyzing' ? '分析中…' : '分析评论'}
          </Button>
        </div>

        {bundle ? (
          bundle.status === 'ok' ? (
            <p className="text-[11px] text-muted-foreground">
              已采集 {bundle.reviews.length} 条 / 共 {bundle.totalReviews}（{bundle.pagesFetched}/{bundle.totalPages} 页）
              {bundle.averageRating != null ? ` · 均分 ${bundle.averageRating}` : ''}
            </p>
          ) : (
            <p className="text-[11px] text-amber-600">采集未成功：{bundle.message || bundle.status}</p>
          )
        ) : null}
        {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      </div>

      {intel ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-[11px] font-semibold">客户画像</p>
          <div className="space-y-1 text-[11px]">
            <MetricRow label="性别倾向" value={intel.customerProfile.genderSplit} />
            {(['who', 'when', 'where', 'what'] as const).map((k) =>
              intel.customerProfile[k].length ? (
                <p key={k}>
                  <span className="text-muted-foreground">{k}：</span>
                  {intel.customerProfile[k].join(' · ')}
                </p>
              ) : null,
            )}
          </div>
          <Entries title="好评归因" items={intel.pros} />
          <Entries title="差评归因" items={intel.cons} />
          <Entries title="消费预期" items={intel.expectations} />
          <Entries title="购买动机" items={intel.motivations} />
          <p className="text-[10px] text-muted-foreground">分析于 {new Date(intel.analyzedAt).toLocaleString()}</p>
        </div>
      ) : intelReason ? (
        <p className="text-[11px] text-muted-foreground">{intelReason}</p>
      ) : null}
    </div>
  );
}
