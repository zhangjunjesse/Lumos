"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { useTranslation } from "@/hooks/useTranslation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Granularity = 'minute' | 'hour' | 'day';

interface UsageBucket {
  bucket: string;
  provider_id: string;
  provider_name: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  estimated_cost_usd: number;
}

interface UsageStatsResponse {
  summary: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
    estimated_cost_usd: number;
    total_sessions: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  buckets: UsageBucket[];
  window_hours: number;
  granularity: Granularity;
}

interface LlmRequestLogRow {
  id: string;
  transport: string;
  module: string;
  operation: string;
  provider_name: string;
  model: string;
  prompt_chars: number;
  status: 'started' | 'succeeded' | 'failed' | 'blocked';
  error_message: string;
  duration_ms: number;
  created_at: string;
}

interface LlmRequestSummaryRow {
  module: string;
  operation: string;
  status: string;
  count: number;
  avg_duration_ms: number;
  last_at: string;
}

interface LlmRequestLogResponse {
  rows: LlmRequestLogRow[];
  summary: LlmRequestSummaryRow[];
}

// ---------------------------------------------------------------------------
// Number formatting helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 0) return "-" + formatTokens(-n);
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return (n / 1_000).toFixed(1) + "K";
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(2) + "M";
  return (n / 1_000_000_000).toFixed(2) + "B";
}

function formatCost(n: number): string {
  if (n <= 0) return "$0.00";
  if (n < 0.01) return "$" + n.toFixed(4);
  if (n >= 1000) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "$" + n.toFixed(2);
}

function formatPercent(n: number | undefined): string {
  if (n === undefined || isNaN(n)) return "N/A";
  if (n === 0) return "0%";
  if (n === 100) return "100%";
  return n.toFixed(1) + "%";
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusClass(status: string): string {
  if (status === 'succeeded') return 'bg-emerald-500/10 text-emerald-600';
  if (status === 'blocked') return 'bg-amber-500/10 text-amber-600';
  if (status === 'failed') return 'bg-red-500/10 text-red-600';
  return 'bg-muted text-muted-foreground';
}

// ---------------------------------------------------------------------------
// Bucket time helpers — must align with backend strftime output
// ---------------------------------------------------------------------------

function pad(n: number): string { return String(n).padStart(2, '0'); }

/**
 * Format a Date in LOCAL timezone matching the backend's
 * `strftime(..., 'localtime')` output. Using toISOString() here would
 * silently reintroduce the UTC bug we're fixing.
 */
function formatLocalBucket(d: Date, g: Granularity): string {
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const da = pad(d.getDate());
  if (g === 'day') return `${y}-${mo}-${da}`;
  const hh = pad(d.getHours());
  if (g === 'hour') return `${y}-${mo}-${da} ${hh}:00:00`;
  return `${y}-${mo}-${da} ${hh}:${pad(d.getMinutes())}:00`;
}

/** Short x-axis label tailored per granularity. */
function formatAxisLabel(bucket: string, g: Granularity): string {
  if (g === 'minute') return bucket.slice(11, 16); // 'HH:mm'
  if (g === 'hour') {
    const mmdd = bucket.slice(5, 10).replace('-', '/');
    return `${mmdd} ${bucket.slice(11, 13)}:00`; // 'MM/dd HH:00'
  }
  const m = parseInt(bucket.slice(5, 7), 10);
  const d = parseInt(bucket.slice(8, 10), 10);
  return `${m}/${d}`;
}

/** Enumerate a full timeline from N*granularity steps ago up to now (local tz). */
function enumerateBuckets(windowHours: number, g: Granularity): string[] {
  const now = new Date();
  const out: string[] = [];
  if (g === 'minute') {
    const end = new Date(now);
    end.setSeconds(0, 0);
    const count = Math.max(1, Math.min(Math.ceil(windowHours * 60), 60 * 24));
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setMinutes(end.getMinutes() - i);
      out.push(formatLocalBucket(d, 'minute'));
    }
  } else if (g === 'hour') {
    const end = new Date(now);
    end.setMinutes(0, 0, 0);
    const count = Math.max(1, Math.min(Math.ceil(windowHours), 24 * 31));
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setHours(end.getHours() - i);
      out.push(formatLocalBucket(d, 'hour'));
    }
  } else {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    const count = Math.max(1, Math.ceil(windowHours / 24));
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      out.push(formatLocalBucket(d, 'day'));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Series color
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function getSeriesColor(idx: number): string {
  return COLOR_PALETTE[idx % COLOR_PALETTE.length];
}

// ---------------------------------------------------------------------------
// Chart tooltip
// ---------------------------------------------------------------------------

type ChartTooltipValue = number | string | ReadonlyArray<number | string>;

function ChartTooltip({ active, payload, label }: TooltipContentProps<ChartTooltipValue, string | number>) {
  if (!active || !payload?.length) return null;

  const items = payload.flatMap((entry) => {
    const rawValue = Array.isArray(entry.value) ? entry.value[0] : entry.value;
    const numericValue =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue)
          : NaN;
    if (!Number.isFinite(numericValue) || numericValue <= 0) return [];
    return [{ entry, numericValue }];
  });

  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      {items.map(({ entry, numericValue }, i) => {
        const displayName = String(entry.name ?? entry.dataKey ?? "unknown");
        const displayColor = entry.color || entry.fill || "var(--color-chart-1)";
        return (
          <div key={displayName + i} className="flex items-center gap-2 text-popover-foreground/80">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: displayColor }} />
            <span>{displayName}</span>
            <span className="ml-auto font-mono">{formatTokens(numericValue)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Range selector
// ---------------------------------------------------------------------------

const RANGE_OPTIONS = [
  { label: '1H', windowHours: 1, granularity: 'minute' as Granularity },
  { label: '24H', windowHours: 24, granularity: 'hour' as Granularity },
  { label: '7D', windowHours: 24 * 7, granularity: 'day' as Granularity },
  { label: '30D', windowHours: 24 * 30, granularity: 'day' as Granularity },
  { label: '90D', windowHours: 24 * 90, granularity: 'day' as Granularity },
] as const;

const DEFAULT_RANGE_IDX = 3; // 30D

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UsageStatsSection() {
  const { t } = useTranslation();
  const [rangeIdx, setRangeIdx] = useState(DEFAULT_RANGE_IDX);
  const [data, setData] = useState<UsageStatsResponse | null>(null);
  const [llmLogData, setLlmLogData] = useState<LlmRequestLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const range = RANGE_OPTIONS[rangeIdx];

  const fetchStats = useCallback(async (windowHours: number, granularity: Granularity) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/usage/stats?window_hours=${windowHours}&granularity=${granularity}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
      const llmRes = await fetch(
        `/api/usage/llm-requests?window_hours=${windowHours}&limit=50`,
        { signal: controller.signal },
      );
      if (llmRes.ok) {
        setLlmLogData(await llmRes.json());
      } else {
        setLlmLogData(null);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(t('usage.loadError')));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchStats(range.windowHours, range.granularity);
    return () => abortRef.current?.abort();
  }, [range.windowHours, range.granularity, fetchStats]);

  const { chartData, series } = useMemo(
    () => deriveChartData(data?.buckets ?? [], range.windowHours, range.granularity),
    [data?.buckets, range.windowHours, range.granularity],
  );

  const summary = data?.summary;
  const totalTokens = summary ? summary.total_input_tokens + summary.total_output_tokens : 0;
  const cacheTotal = summary ? summary.cache_read_tokens + summary.total_input_tokens : 0;
  const cacheRate = summary && cacheTotal > 0 ? (summary.cache_read_tokens / cacheTotal) * 100 : undefined;
  const displayCost = summary ? summary.estimated_cost_usd : 0;
  const hasEstimate = !!summary && summary.estimated_cost_usd > summary.total_cost_usd + 1e-9;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Range selector */}
      <div className="flex items-center gap-2">
        {RANGE_OPTIONS.map((opt, i) => (
          <button
            key={opt.label}
            onClick={() => setRangeIdx(i)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              rangeIdx === i
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Data cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t('usage.totalTokens')}
          value={loading ? "–" : formatTokens(totalTokens)}
          sub={
            summary
              ? `${t('usage.input')} ${formatTokens(summary.total_input_tokens)} · ${t('usage.output')} ${formatTokens(summary.total_output_tokens)}`
              : undefined
          }
        />
        <StatCard
          label={t('usage.totalCost')}
          value={loading ? "–" : formatCost(displayCost)}
          sub={hasEstimate ? t('usage.costHint') : undefined}
        />
        <StatCard
          label={t('usage.sessions')}
          value={loading ? "–" : String(summary?.total_sessions ?? 0)}
        />
        <StatCard
          label={t('usage.cacheHitRate')}
          value={loading ? "–" : formatPercent(cacheRate)}
          sub={
            summary && summary.cache_read_tokens > 0
              ? `${formatTokens(summary.cache_read_tokens)} ${t('usage.cached')}`
              : undefined
          }
        />
      </div>

      {/* Bar chart */}
      <div className="rounded-lg border border-border/50 p-4">
        <h3 className="mb-4 text-sm font-medium">{t('usage.dailyChart')}</h3>

        {loading && (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            {t('usage.loading')}
          </div>
        )}

        {error && (
          <div className="flex h-64 items-center justify-center text-sm text-red-500">
            {error}
          </div>
        )}

        {!loading && !error && series.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-40"
            >
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
            <p className="text-sm">{t('usage.noData')}</p>
            <p className="text-xs">{t('usage.noDataHint')}</p>
          </div>
        )}

        {!loading && !error && series.length > 0 && (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={range.granularity === 'minute' ? 20 : 8}
              />
              <YAxis
                tickFormatter={formatTokens}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={54}
              />
              <Tooltip content={(props) => <ChartTooltip {...props} />} cursor={{ fill: "var(--color-accent)", opacity: 0.3 }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={8} />
              {series.map((s, idx) => (
                <Bar
                  key={s}
                  name={s}
                  dataKey={s}
                  stackId="tokens"
                  fill={getSeriesColor(idx)}
                  radius={idx === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                  maxBarSize={40}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="rounded-lg border border-border/50 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">LLM 请求账本</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              按模块记录最近请求；默认只保存 prompt 长度和 hash，不保存完整正文。
            </p>
          </div>
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            最近 {range.label}
          </span>
        </div>

        {llmLogData?.summary?.length ? (
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {llmLogData.summary.slice(0, 4).map((item) => (
              <div
                key={`${item.module}:${item.operation}:${item.status}`}
                className="rounded-md border border-border/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">
                    {item.module || 'unknown'} / {item.operation || 'unknown'}
                  </span>
                  <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${statusClass(item.status)}`}>
                    {item.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.count} 次 · 平均 {formatDurationMs(item.avg_duration_ms)}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {!llmLogData?.rows?.length ? (
          <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
            暂无 LLM 请求记录
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-border/60 text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">模块</th>
                  <th className="py-2 pr-3 font-medium">Provider / Model</th>
                  <th className="py-2 pr-3 font-medium">Prompt</th>
                  <th className="py-2 pr-3 font-medium">耗时</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {llmLogData.rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground">{row.created_at}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{row.module || 'unknown'}</div>
                      <div className="text-muted-foreground">{row.operation || 'unknown'}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{row.provider_name || 'unknown'}</div>
                      <div className="text-muted-foreground">{row.model || '-'}</div>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {row.prompt_chars.toLocaleString()} chars
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatDurationMs(row.duration_ms)}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusClass(row.status)}`}>
                        {row.status}
                      </span>
                      {row.error_message ? (
                        <div className="mt-1 max-w-[220px] truncate text-[11px] text-muted-foreground" title={row.error_message}>
                          {row.error_message}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 p-4 transition-shadow hover:shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data transform
// ---------------------------------------------------------------------------

function deriveChartData(
  buckets: UsageBucket[],
  windowHours: number,
  granularity: Granularity,
): {
  chartData: Array<Record<string, string | number>>;
  series: string[];
} {
  const timeline = enumerateBuckets(windowHours, granularity);
  const empty = timeline.map((b) => ({ bucket: b, label: formatAxisLabel(b, granularity) }));
  if (buckets.length === 0) return { chartData: empty, series: [] };

  const seriesSet = new Set<string>();
  const byBucket = new Map<string, Record<string, number>>();
  for (const row of buckets) {
    const key = `${row.provider_name} / ${row.model_name}`;
    seriesSet.add(key);
    const tokens = row.input_tokens + row.output_tokens;
    if (!byBucket.has(row.bucket)) byBucket.set(row.bucket, {});
    const entry = byBucket.get(row.bucket)!;
    entry[key] = (entry[key] || 0) + tokens;
  }

  const series = Array.from(seriesSet).sort();
  const chartData = timeline.map((b) => {
    const row: Record<string, string | number> = {
      bucket: b,
      label: formatAxisLabel(b, granularity),
    };
    const entry = byBucket.get(b) || {};
    for (const s of series) row[s] = entry[s] || 0;
    return row;
  });

  return { chartData, series };
}
