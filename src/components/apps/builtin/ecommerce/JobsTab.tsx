'use client';

import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleX,
  Clock,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { ImageJob, ImageOutput, ProductInput } from './types';
import { buildFailedJobAskAiPrompt, dispatchAskAi } from './ecommerce-ask-ai';

interface JobsTabProps {
  jobs: ImageJob[];
  outputs: ImageOutput[];
  inputs: ProductInput[];
  loading: boolean;
  refreshing: boolean;
  onChanged: () => void;
}

export function JobsTab({
  jobs,
  outputs,
  inputs,
  loading,
  refreshing,
  onChanged,
}: JobsTabProps): React.ReactElement {
  const inputMap = React.useMemo(() => {
    const map = new Map<string, ProductInput>();
    for (const item of inputs) map.set(item.id, item);
    return map;
  }, [inputs]);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">出图任务</CardTitle>
          <span className="text-xs text-muted-foreground">
            {refreshing ? '同步中…' : `${jobs.length} 条`}
          </span>
        </CardHeader>
        <CardContent>
          {loading && jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有任务。请先在「工坊」页新建商品输入并启动一次出图。
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  input={inputMap.get(job.input_id) ?? null}
                  outputs={outputs.filter((output) => output.job_id === job.id)}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const SOP_STEPS = [
  { id: 'preprocessing', label: '预处理' },
  { id: 'identifying', label: '识别 brief' },
  { id: 'cutting', label: '抠图' },
  { id: 'planning', label: '规划方向' },
  { id: 'generating', label: '生成草图' },
  { id: 'scoring', label: 'AI 评分' },
  { id: 'refining', label: '终版精修' },
  { id: 'qc', label: '质检' },
] as const;

const TERMINAL = ['completed', 'failed', 'cancelled'] as const;

function isTerminal(status: string): boolean {
  return (TERMINAL as readonly string[]).includes(status);
}

function JobRow({
  job,
  input,
  outputs,
  onChanged,
}: {
  job: ImageJob;
  input: ProductInput | null;
  outputs: ImageOutput[];
  onChanged: () => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState<'cancel' | 'retry' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const callAction = async (action: 'cancel' | 'retry') => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/jobs/${job.id}/${action}`, {
        method: 'POST',
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '操作失败');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  // group outputs by kind for the SOP timeline
  const cutouts = outputs.filter((o) => o.kind === 'cutout').sort(byIteration);
  const catalogs = outputs.filter((o) => o.kind === 'catalog').sort(byIteration);
  const lifestyles = outputs.filter((o) => o.kind === 'lifestyle').sort(byIteration);
  const campaigns = outputs.filter((o) => o.kind === 'campaign').sort(byIteration);
  const finals = outputs.filter((o) => o.kind === 'final').sort(byIteration);
  const fallbacks = outputs.filter((o) => o.kind === 'fallback').sort(byIteration);

  const stepStatus = computeStepStatus(job);

  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {input ? input.title : `任务 ${job.id.slice(0, 8)}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1">{job.status}</code>
            {job.stage ? ` · ${job.stage}` : ''}
            {typeof job.progress === 'number' ? ` · ${job.progress}%` : ''}
            {job.winner_direction ? ` · 选中方向 ${job.winner_direction}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => callAction('cancel')}
            disabled={busy !== null || isTerminal(job.status)}
          >
            <CircleX className="size-3.5" />
            取消
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => callAction('retry')}
            disabled={busy !== null}
          >
            <RefreshCw className="size-3.5" />
            重新运行
          </Button>
        </div>
      </div>

      {/* SOP step timeline */}
      <SopTimeline status={job.status} stage={job.stage ?? null} stepStatus={stepStatus} />

      {/* progress bar */}
      {!isTerminal(job.status) && typeof job.progress === 'number' ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-all"
            style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
          />
        </div>
      ) : null}

      {job.failure_reason ? (
        <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center justify-between gap-2 font-semibold">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="size-3.5" /> 失败原因
              {job.failure_stage ? <span className="font-normal">（阶段：{job.failure_stage}）</span> : null}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-xs text-destructive hover:bg-destructive/15"
              onClick={() =>
                dispatchAskAi(
                  buildFailedJobAskAiPrompt({
                    jobId: job.id,
                    jobStatus: job.status,
                    jobStage: job.stage,
                    inputTitle: input?.title ?? null,
                    failureReason: job.failure_reason,
                    failureStage: job.failure_stage,
                  }),
                )
              }
            >
              <Sparkles className="size-3.5" />
              问 AI 排查
            </Button>
          </div>
          <p className="mt-1">{job.failure_reason}</p>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {/* SOP intermediate products by group */}
      {outputs.length > 0 ? (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          {cutouts.length > 0 ? (
            <OutputGroup label="抠图" items={cutouts} />
          ) : null}
          {(catalogs.length > 0 || lifestyles.length > 0 || campaigns.length > 0) ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                3 方向草图
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <DirectionColumn label="catalog (商品主图)" items={catalogs} winner={job.winner_direction === 'catalog'} />
                <DirectionColumn label="lifestyle (生活)" items={lifestyles} winner={job.winner_direction === 'lifestyle'} />
                <DirectionColumn label="campaign (高端)" items={campaigns} winner={job.winner_direction === 'campaign'} />
              </div>
            </div>
          ) : null}
          {finals.length > 0 ? (
            <OutputGroup label="终版精修" items={finals} highlightFinal />
          ) : null}
          {fallbacks.length > 0 ? (
            <OutputGroup label="兜底（白底）" items={fallbacks} />
          ) : null}
        </div>
      ) : !isTerminal(job.status) ? (
        <p className="text-center text-xs text-muted-foreground">
          还没有中间产物，AI 正在执行 SOP…
        </p>
      ) : null}
    </li>
  );
}

function byIteration(a: ImageOutput, b: ImageOutput): number {
  return (a.iteration ?? 0) - (b.iteration ?? 0);
}

function OutputGroup({
  label,
  items,
  highlightFinal,
}: {
  label: string;
  items: ImageOutput[];
  highlightFinal?: boolean;
}): React.ReactElement {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((o) => (
          <ImageThumb
            key={o.id}
            label={`${o.kind}#${o.iteration ?? 1}`}
            path={o.image_path}
            highlight={highlightFinal && o.is_winner === true}
            qc={{
              pass: o.qc_pass ?? undefined,
              summary: o.qc_summary ?? undefined,
              fail: o.qc_fail_reason ?? undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function DirectionColumn({
  label,
  items,
  winner,
}: {
  label: string;
  items: ImageOutput[];
  winner?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`rounded-md border bg-background p-2 ${
        winner ? 'ring-2 ring-emerald-500' : ''
      }`}
    >
      <p className="mb-1 truncate text-[10px] font-medium text-muted-foreground">
        {label} {winner ? <span className="text-emerald-600">✓ 选中</span> : null}
      </p>
      {items.length === 0 ? (
        <div className="flex aspect-square items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
          —
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((o) => (
            <ImageThumb
              key={o.id}
              label={`#${o.iteration ?? 1}`}
              path={o.image_path}
              size="sm"
              qc={{
                pass: o.qc_pass ?? undefined,
                summary: o.qc_summary ?? undefined,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface QcDisplay {
  pass?: boolean;
  summary?: string;
  fail?: string;
}

function ImageThumb({
  label,
  path,
  highlight,
  size,
  qc,
}: {
  label: string;
  path: string;
  highlight?: boolean;
  size?: 'sm' | 'md';
  qc?: QcDisplay;
}): React.ReactElement {
  const previewUrl = `/api/uploads?path=${encodeURIComponent(path)}`;
  const dim = size === 'sm' ? 'h-12 w-12' : 'h-20 w-20';
  const tooltip = [
    path,
    qc?.summary ? `QC: ${qc.summary}` : '',
    qc?.fail ? `失败: ${qc.fail}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <a
      href={previewUrl}
      target="_blank"
      rel="noreferrer"
      title={tooltip}
      className={`group relative flex flex-col gap-1 rounded-md border bg-card p-1 transition hover:ring-1 hover:ring-foreground/40 ${
        highlight ? 'ring-2 ring-emerald-500' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 本地文件预览 */}
      <img
        src={previewUrl}
        alt={label}
        loading="lazy"
        className={`${dim} rounded object-cover`}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <span className="text-center text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {qc?.pass === true ? (
        <CheckCircle2 className="absolute right-1 top-1 size-3 fill-background text-emerald-600" />
      ) : qc?.pass === false ? (
        <XCircle className="absolute right-1 top-1 size-3 fill-background text-red-600" />
      ) : null}
    </a>
  );
}

function SopTimeline({
  status,
  stage,
  stepStatus,
}: {
  status: string;
  stage: string | null;
  stepStatus: Record<string, 'pending' | 'active' | 'done' | 'failed' | 'skipped'>;
}): React.ReactElement {
  void status;
  void stage;
  return (
    <ol className="flex flex-wrap items-center gap-1 overflow-x-auto">
      {SOP_STEPS.map((s, i) => {
        const st = stepStatus[s.id] ?? 'pending';
        const cls =
          st === 'done'
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900'
            : st === 'active'
            ? 'bg-blue-50 text-blue-700 ring-blue-200 animate-pulse dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900'
            : st === 'failed'
            ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900'
            : st === 'skipped'
            ? 'bg-muted text-muted-foreground ring-border opacity-60'
            : 'bg-background text-muted-foreground ring-border';
        const Icon =
          st === 'done'
            ? CheckCircle2
            : st === 'failed'
            ? XCircle
            : st === 'active'
            ? Loader2
            : Clock;
        return (
          <React.Fragment key={s.id}>
            <li
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] tabular-nums ring-1 ${cls}`}
              title={s.label}
            >
              <Icon className={`size-2.5 ${st === 'active' ? 'animate-spin' : ''}`} />
              {s.label}
            </li>
            {i < SOP_STEPS.length - 1 ? (
              <span className="text-muted-foreground">›</span>
            ) : null}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

function computeStepStatus(
  job: ImageJob,
): Record<string, 'pending' | 'active' | 'done' | 'failed' | 'skipped'> {
  const out: Record<string, 'pending' | 'active' | 'done' | 'failed' | 'skipped'> = {};
  const order = SOP_STEPS.map((s) => s.id);
  // map job.status into the SOP-step phase
  const STATUS_TO_STEP: Record<string, string> = {
    queued: 'preprocessing',
    preprocessing: 'preprocessing',
    identifying: 'identifying',
    cutting: 'cutting',
    planning: 'planning',
    generating: 'generating',
    scoring: 'scoring',
    refining: 'refining',
    qc: 'qc',
  };
  if (job.status === 'completed') {
    for (const s of order) out[s] = 'done';
    return out;
  }
  if (job.status === 'cancelled') {
    for (const s of order) out[s] = 'skipped';
    return out;
  }
  const failedAt = job.status === 'failed' ? job.failure_stage ?? job.stage ?? null : null;
  const currentStep = STATUS_TO_STEP[job.status] ?? null;
  let phase: 'pre' | 'at' | 'post' = 'pre';
  for (const s of order) {
    if (failedAt && s === failedAt) {
      out[s] = 'failed';
      phase = 'post';
      continue;
    }
    if (failedAt && phase === 'pre') {
      out[s] = 'done';
      continue;
    }
    if (failedAt && phase === 'post') {
      out[s] = 'skipped';
      continue;
    }
    if (currentStep && s === currentStep) {
      out[s] = 'active';
      phase = 'at';
      continue;
    }
    if (currentStep && phase === 'pre') {
      out[s] = 'done';
      continue;
    }
    if (currentStep && phase === 'at') {
      out[s] = 'pending';
      continue;
    }
    out[s] = 'pending';
  }
  // Force the keep-it-simple "all icons present" invariant in case the
  // status string isn't recognised at all.
  if (!currentStep && !failedAt && job.status !== 'completed' && job.status !== 'cancelled') {
    for (const s of order) out[s] = 'pending';
  }
  return out;
}
