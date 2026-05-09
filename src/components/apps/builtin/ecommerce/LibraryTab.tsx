'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { ImageJob, ImageOutput, ProductInput } from './types';

interface LibraryTabProps {
  jobs: ImageJob[];
  outputs: ImageOutput[];
  inputs: ProductInput[];
  loading: boolean;
}

export function LibraryTab({ jobs, outputs, inputs, loading }: LibraryTabProps): React.ReactElement {
  const inputMap = React.useMemo(() => new Map(inputs.map((item) => [item.id, item])), [inputs]);
  const finalAssets = React.useMemo(() => {
    return outputs
      .filter((o) => o.kind === 'final' || o.kind === 'fallback')
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  }, [outputs]);
  const winnerById = React.useMemo(() => {
    const map = new Map<string, ImageOutput>();
    for (const output of finalAssets) {
      if (output.is_winner) map.set(output.job_id, output);
    }
    return map;
  }, [finalAssets]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">已生成图片</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && finalAssets.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : finalAssets.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有生成的成品，跑一次出图任务后会出现在这里。
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {finalAssets.map((output) => {
                const job = jobs.find((j) => j.id === output.job_id);
                const input = job ? inputMap.get(job.input_id) ?? null : null;
                const isWinner = winnerById.get(output.job_id)?.id === output.id;
                return (
                  <ImageTile
                    key={output.id}
                    output={output}
                    inputTitle={input?.title}
                    direction={job?.winner_direction ?? null}
                    isWinner={isWinner}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ImageTile({
  output,
  inputTitle,
  direction,
  isWinner,
}: {
  output: ImageOutput;
  inputTitle?: string;
  direction?: string | null;
  isWinner?: boolean;
}): React.ReactElement {
  const previewUrl = `/api/uploads?path=${encodeURIComponent(output.image_path)}`;
  return (
    <a
      href={previewUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-2 rounded-md border bg-card p-3 transition hover:ring-1 hover:ring-foreground/40"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 本地文件预览 */}
      <img
        src={previewUrl}
        alt={inputTitle ?? '生成结果'}
        className="aspect-[4/5] w-full rounded-md object-cover"
        loading="lazy"
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-foreground">{inputTitle ?? output.job_id.slice(0, 8)}</span>
        <div className="flex shrink-0 items-center gap-1">
          {isWinner ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
              终版
            </span>
          ) : null}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            {output.kind}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{direction ?? '—'}</span>
        <span>{output.created_at ? new Date(output.created_at).toLocaleString() : ''}</span>
      </div>
    </a>
  );
}
