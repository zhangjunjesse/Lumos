'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { api } from './api';
import { RunView } from './RunView';
import { StatusBadge } from './StatusBadge';
import type { RunDto } from './types';

export function HistoryTab({ active }: { active: boolean }): React.ReactElement {
  const [runs, setRuns] = React.useState<RunDto[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await api.listRuns();
      setRuns(data.runs);
    } catch {
      setRuns([]);
    }
  }, []);

  React.useEffect(() => {
    if (active) void load();
  }, [active, load]);

  React.useEffect(() => {
    if (!active || !runs?.some((r) => r.status === 'running')) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [active, runs, load]);

  if (selectedId) {
    return <RunView runId={selectedId} onBack={() => { setSelectedId(null); void load(); }} />;
  }

  if (runs === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载运行历史…
      </div>
    );
  }

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">还没有查询记录。去「查询」页跑第一次。</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-border">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            <th className="px-3 py-2 font-medium">时间</th>
            <th className="px-3 py-2 font-medium">来源</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">进度</th>
            <th className="px-3 py-2 font-medium">命中</th>
            <th className="px-3 py-2 font-medium">失败原因</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b last:border-0 hover:bg-muted/20">
              <td className="px-3 py-2 tabular-nums">{formatTime(run.started_at)}</td>
              <td className="px-3 py-2">{run.source === 'monitor' ? '每日监控' : '手动'}</td>
              <td className="px-3 py-2"><StatusBadge kind="run" status={run.status} /></td>
              <td className="px-3 py-2 tabular-nums">{run.keywords_done}/{run.keywords_total}</td>
              <td className="px-3 py-2 tabular-nums">{run.matches_total}</td>
              <td className="max-w-md truncate px-3 py-2 text-xs text-muted-foreground" title={run.failure_reason}>
                {run.failure_reason ?? ''}
              </td>
              <td className="px-3 py-2">
                <Button variant="ghost" size="sm" onClick={() => setSelectedId(run.id)}>打开</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
