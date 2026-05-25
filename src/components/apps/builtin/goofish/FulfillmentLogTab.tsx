'use client';

import * as React from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { FulfillmentDetailDialog } from './FulfillmentDetailDialog';
import { useFulfillmentLog, type FulfillmentLogRow } from './use-fulfillment-log';

type SourceFilter = 'all' | 'auto_scan' | 'manual_button' | 'ai_in_chat';
type StatusFilter = 'all' | 'sent' | 'failed' | 'duplicate_skip' | 'pending';

const SOURCE_FILTERS: Array<{ key: SourceFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'auto_scan', label: '自动' },
  { key: 'manual_button', label: '手动' },
  { key: 'ai_in_chat', label: 'AI 助手' },
];

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'sent', label: '成功' },
  { key: 'failed', label: '失败' },
  { key: 'duplicate_skip', label: '去重' },
];

export function FulfillmentLogTab(): React.ReactElement {
  const { rows, loading, error, refresh, retry } = useFulfillmentLog();
  const [source, setSource] = React.useState<SourceFilter>('all');
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [detail, setDetail] = React.useState<FulfillmentLogRow | null>(null);

  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      if (source !== 'all' && r.trigger_source !== source) return false;
      if (status !== 'all' && r.status !== status) return false;
      return true;
    });
  }, [rows, source, status]);

  const counters = React.useMemo(() => {
    const startOfToday = startOfDayMs();
    const startOfWeek = startOfWeekMs();
    return {
      today: rows.filter((r) => parseTs(r.sent_at) >= startOfToday).length,
      week: rows.filter((r) => parseTs(r.sent_at) >= startOfWeek).length,
      total: rows.length,
      failed: rows.filter((r) => r.status === 'failed').length,
    };
  }, [rows]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">发货记录</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            今日 {counters.today} · 本周 {counters.week} · 总 {counters.total} · 失败 {counters.failed}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          刷新
        </Button>
      </header>

      <div className="flex flex-wrap gap-4">
        <FilterGroup
          label="触发"
          options={SOURCE_FILTERS}
          value={source}
          onChange={setSource}
        />
        <FilterGroup
          label="状态"
          options={STATUS_FILTERS}
          value={status}
          onChange={setStatus}
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 加载发货流水…
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
            还没有发货记录
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">时间</th>
                  <th className="px-3 py-2 text-left font-medium">触发</th>
                  <th className="px-3 py-2 text-left font-medium">买家</th>
                  <th className="px-3 py-2 text-left font-medium">商品（库内）</th>
                  <th className="px-3 py-2 text-left font-medium">状态</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {formatTime(row.sent_at || row.created_at)}
                    </td>
                    <td className="px-3 py-2"><SourceBadge value={row.trigger_source} /></td>
                    <td className="px-3 py-2 max-w-[120px] truncate">{row.buyer_name || '—'}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate">{row.product_title || row.item_title || '—'}</td>
                    <td className="px-3 py-2"><StatusBadge value={row.status} /></td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setDetail(row)}
                      >查看</Button>
                      {row.status === 'failed' ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void retry(row.id)}
                          className="ml-1"
                        >重发</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {detail ? (
        <FulfillmentDetailDialog
          row={detail}
          onClose={() => setDetail(null)}
          onRetry={async () => {
            await retry(detail.id);
            setDetail(null);
          }}
        />
      ) : null}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <Button
            key={o.key}
            type="button"
            size="xs"
            variant={value === o.key ? 'default' : 'outline'}
            onClick={() => onChange(o.key)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SourceBadge({ value }: { value?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    auto_scan: { label: '自动', cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
    manual_button: { label: '手动', cls: 'bg-muted text-foreground' },
    ai_in_chat: { label: 'AI 助手', cls: 'bg-purple-500/10 text-purple-700 dark:text-purple-300' },
  };
  const cfg = map[value ?? ''] ?? { label: value || '—', cls: 'bg-muted text-muted-foreground' };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px]', cfg.cls)}>{cfg.label}</span>
  );
}

function StatusBadge({ value }: { value?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sent: { label: '已发', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
    failed: { label: '失败', cls: 'bg-destructive/10 text-destructive' },
    duplicate_skip: { label: '去重', cls: 'bg-muted text-muted-foreground' },
    pending: { label: '待处理', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  };
  const cfg = map[value ?? ''] ?? { label: value || '—', cls: 'bg-muted text-muted-foreground' };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px]', cfg.cls)}>{cfg.label}</span>
  );
}

function parseTs(iso?: string | null): number {
  if (!iso) return 0;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : 0;
}

function startOfDayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekMs(): number {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
