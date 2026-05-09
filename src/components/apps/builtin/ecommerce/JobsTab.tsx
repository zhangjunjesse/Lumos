'use client';

import * as React from 'react';
import { CircleX, RefreshCw, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { ImageJob, ImageOutput, ProductInput } from './types';

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

  const finalOutput = outputs.find((o) => o.kind === 'final' && o.is_winner)
    ?? outputs.find((o) => o.kind === 'final')
    ?? outputs.find((o) => o.kind === 'fallback');
  const cutoutOutput = outputs.find((o) => o.kind === 'cutout' && o.qc_pass)
    ?? outputs.find((o) => o.kind === 'cutout');

  return (
    <li className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {input ? input.title : `任务 ${job.id.slice(0, 8)}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            状态 <code className="rounded bg-muted px-1">{job.status}</code>
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
            disabled={
              busy !== null
              || ['completed', 'failed', 'cancelled'].includes(job.status)
            }
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

      {job.failure_reason ? (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          失败原因：{job.failure_reason}
          {job.failure_stage ? `（${job.failure_stage}）` : ''}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {(finalOutput || cutoutOutput) ? (
        <div className="flex flex-wrap gap-3">
          {cutoutOutput ? (
            <ImageThumb label="抠图" path={cutoutOutput.image_path} />
          ) : null}
          {finalOutput ? (
            <ImageThumb
              label={finalOutput.kind === 'fallback' ? '兜底' : '终版'}
              path={finalOutput.image_path}
              highlight={finalOutput.kind === 'final'}
            />
          ) : null}
        </div>
      ) : null}

      {outputs.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            <Settings2 className="mr-1 inline size-3" />
            查看所有阶段产物（{outputs.length} 张）
          </summary>
          <ul className="mt-2 space-y-1">
            {outputs.map((output) => (
              <li key={output.id} className="rounded bg-muted/40 px-2 py-1">
                <code className="text-[10px]">{output.kind}#{output.iteration}</code>
                {' · '}
                {output.image_path}
                {output.qc_pass !== null && output.qc_pass !== undefined ? (
                  <span className="ml-2">
                    {output.qc_pass ? '✓ QC pass' : '✕ QC fail'}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function ImageThumb({
  label,
  path,
  highlight,
}: {
  label: string;
  path: string;
  highlight?: boolean;
}): React.ReactElement {
  const previewUrl = `/api/uploads?path=${encodeURIComponent(path)}`;
  return (
    <a
      href={previewUrl}
      target="_blank"
      rel="noreferrer"
      title={path}
      className={`group flex flex-col gap-1 rounded-md border bg-card p-1 transition hover:ring-1 hover:ring-foreground/40 ${
        highlight ? 'ring-1 ring-emerald-400/60' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 本地文件预览 */}
      <img
        src={previewUrl}
        alt={label}
        loading="lazy"
        className="h-16 w-16 rounded object-cover"
      />
      <span className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </a>
  );
}
