'use client';

// 单个采集任务卡片：状态展示 + 编辑数量/采集门槛/调度，启用·立即爬·删除。
// 采集门槛（销量≥/收藏≥）失焦即存；0=不过滤。门槛靠 EHunt 指标，需 AdsPower 浏览器。

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { KeywordTask, TaskSchedule } from '../api-client';

const SCHEDULE_LABELS: Record<TaskSchedule, string> = {
  manual: '仅手动',
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
};
const STATUS_LABELS: Record<string, string> = {
  idle: '待运行',
  running: '运行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  cancelled: '已取消',
};
export const MAX_CAP = 500;
export const clampMax = (n: number) => Math.max(1, Math.min(MAX_CAP, Math.floor(n) || 48));
const clampThreshold = (n: number) => Math.max(0, Math.floor(n) || 0);
// 价格门槛：非负、两位小数、0=不限（与后端 clampPrice 对齐）。
export const clampPriceField = (n: number) =>
  !Number.isFinite(n) || n <= 0 ? 0 : Math.round(n * 100) / 100;
// 最大翻页数：整数，夹在 [1, 100]（与后端 clampPages 对齐）。
export const PAGES_CAP = 100;
export const clampPagesField = (n: number) => Math.max(1, Math.min(PAGES_CAP, Math.floor(n) || 40));

export interface TaskPatch {
  enabled?: boolean;
  schedule?: TaskSchedule;
  max_products?: number;
  min_sales?: number;
  min_favorites?: number;
  min_price?: number;
  max_price?: number;
  max_pages?: number;
}

function statusClass(s: string): string {
  if (s === 'success') return 'border-emerald-600/40 text-emerald-600 dark:text-emerald-400';
  if (s === 'failed') return 'border-destructive/40 text-destructive';
  if (s === 'running') return 'border-amber-600/40 text-amber-600 dark:text-amber-400';
  return 'border-border text-muted-foreground';
}

function NumberField({
  value,
  min,
  max,
  step,
  width,
  title,
  onCommit,
}: {
  value: number;
  min: number;
  max?: number;
  step?: number;
  width: string;
  title: string;
  onCommit: (v: number) => void;
}) {
  return (
    <input
      key={value}
      type="number"
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      title={title}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={(e) => onCommit(Number(e.target.value))}
      className={`h-8 ${width} rounded-md border border-input bg-background px-2 text-xs`}
    />
  );
}

export function TaskCard({
  task: t,
  running,
  stopping,
  onRun,
  onStop,
  onPatch,
  onRemove,
}: {
  task: KeywordTask;
  running: boolean;
  stopping: boolean;
  onRun: () => void;
  onStop: () => void;
  onPatch: (p: TaskPatch) => void;
  onRemove: () => void;
}) {
  const isRunning = running || t.last_status === 'running';
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-medium">{t.keyword}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            累积采集 {t.total_collected} 个商品 ·{' '}
            {t.last_run_at ? new Date(t.last_run_at).toLocaleString() : '从未运行'}
          </p>
        </div>
        <span className={'rounded border px-2 py-0.5 text-[10px] ' + statusClass(t.last_status)}>
          {STATUS_LABELS[t.last_status] ?? t.last_status}
        </span>
      </div>
      {t.last_status === 'failed' && t.last_failure_reason && (
        <p className="mb-3 break-words rounded bg-destructive/10 p-2 text-xs text-destructive">
          {t.last_failure_reason}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {isRunning ? (
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={stopping}
            title="翻完手头这页就收手，已爬到的保留入库"
            onClick={onStop}
          >
            {stopping ? '停止中…' : '停止'}
          </Button>
        ) : (
          <Button size="sm" onClick={onRun}>
            {`立即爬（${t.max_products} 个）`}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => onPatch({ enabled: !t.enabled })}>
          {t.enabled ? '禁用' : '启用'}
        </Button>
        <div className="flex items-center gap-1">
          <NumberField
            value={t.max_products}
            min={1}
            max={MAX_CAP}
            width="w-16"
            title="想爬多少个（自动翻页，上限 500）"
            onCommit={(v) => {
              const c = clampMax(v);
              if (c !== t.max_products) onPatch({ max_products: c });
            }}
          />
          <span className="text-xs text-muted-foreground">个</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">翻页</span>
          <NumberField
            value={t.max_pages ?? 40}
            min={1}
            max={PAGES_CAP}
            width="w-14"
            title="最大翻页数（往深里翻多少页找达标新品，默认 40，上限 100）"
            onCommit={(v) => {
              const c = clampPagesField(v);
              if (c !== (t.max_pages ?? 40)) onPatch({ max_pages: c });
            }}
          />
          <span className="text-xs text-muted-foreground">页</span>
        </div>
        <Select value={t.schedule} onValueChange={(v) => onPatch({ schedule: v as TaskSchedule })}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SCHEDULE_LABELS) as TaskSchedule[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SCHEDULE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onRemove}>
          删除
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>采集门槛</span>
        <span className="flex items-center gap-1">
          销量≥
          <NumberField
            value={t.min_sales ?? 0}
            min={0}
            width="w-20"
            title="销量低于此值不采（0=不过滤）"
            onCommit={(v) => {
              const c = clampThreshold(v);
              if (c !== (t.min_sales ?? 0)) onPatch({ min_sales: c });
            }}
          />
        </span>
        <span className="flex items-center gap-1">
          收藏≥
          <NumberField
            value={t.min_favorites ?? 0}
            min={0}
            width="w-20"
            title="收藏低于此值不采（0=不过滤）"
            onCommit={(v) => {
              const c = clampThreshold(v);
              if (c !== (t.min_favorites ?? 0)) onPatch({ min_favorites: c });
            }}
          />
        </span>
        <span className="flex items-center gap-1">
          价格
          <NumberField
            value={t.min_price ?? 0}
            min={0}
            step={0.01}
            width="w-20"
            title="价格低于此值不采（0=不限，按商品标价）"
            onCommit={(v) => {
              const c = clampPriceField(v);
              if (c !== (t.min_price ?? 0)) onPatch({ min_price: c });
            }}
          />
          –
          <NumberField
            value={t.max_price ?? 0}
            min={0}
            step={0.01}
            width="w-20"
            title="价格高于此值不采（0=不限，按商品标价）"
            onCommit={(v) => {
              const c = clampPriceField(v);
              if (c !== (t.max_price ?? 0)) onPatch({ max_price: c });
            }}
          />
        </span>
        <span>销量/收藏需 EHunt（AdsPower）；价格按标价过滤，普通浏览器也可</span>
      </div>
    </div>
  );
}
