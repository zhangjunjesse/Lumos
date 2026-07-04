'use client';

import * as React from 'react';
import { ArrowLeft, Download, ExternalLink, Loader2, Square } from 'lucide-react';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { api } from './api';
import { StatusBadge } from './StatusBadge';
import type { ResultDto, RunDto } from './types';
import { RUN_STATUS_TEXT } from './types';

interface Props {
  runId: string;
  onBack?: () => void;
  backLabel?: string;
}

export function RunView({ runId, onBack, backLabel = '返回' }: Props): React.ReactElement {
  const [run, setRun] = React.useState<RunDto | null>(null);
  const [results, setResults] = React.useState<ResultDto[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [monitorMessage, setMonitorMessage] = React.useState<string | null>(null);

  const running = run?.status === 'running';

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const data = await api.getRun(runId);
        if (cancelled) return;
        setRun(data.run);
        setResults(data.results);
        setError(null);
        if (data.run.status === 'running') {
          timer = setTimeout(() => void poll(), 1_500);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        timer = setTimeout(() => void poll(), 3_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  if (!run) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载运行详情…
      </div>
    );
  }

  const keywords = results.map((r) => r.keyword);
  const asins = (run.asins ?? []).map((a) => a.toUpperCase());

  const setMonitor = async () => {
    try {
      await api.setDailyMonitor(keywords, asins);
      setMonitorMessage('已设为每日监控：清单已保存、自动化已开启、定时任务已同步。可在「自动化」页查看。');
    } catch (err) {
      setMonitorMessage(`设置失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {onBack ? (
          <Button variant="outline" size="sm" onClick={onBack} disabled={running}>
            <ArrowLeft className="size-3.5" />
            {backLabel}
          </Button>
        ) : null}
        <StatusBadge kind="run" status={run.status} />
        <span className="text-sm tabular-nums text-muted-foreground">
          {run.keywords_done}/{run.keywords_total} 个关键词 · 命中 {run.matches_total} 个排名
        </span>
        {running ? (
          <Button variant="outline" size="sm" onClick={() => void api.stopRun(run.id).catch(() => {})}>
            <Square className="size-3.5" />
            停止
          </Button>
        ) : (
          <>
            <Button asChild variant="outline" size="sm">
              <a href={api.exportUrl(run.id)} download>
                <Download className="size-3.5" />
                导出 Excel
              </a>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">设为每日监控</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>设为每日监控？</AlertDialogTitle>
                  <AlertDialogDescription>
                    把本次的 {keywords.length} 个关键词和 {asins.length} 个 ASIN 存为监控清单，
                    每天 09:00 自动查一遍排名；绑定微信 IM 后会推送摘要。会按计划消耗浏览器抓取资源。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void setMonitor()}>确认开启</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      {run.status !== 'running' && !run.zip_confirmed ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          配送邮编（{run.zip_code}）未确认设置成功，结果可能按亚马逊默认地区排序。
        </p>
      ) : null}

      {run.failure_reason ? (
        <Alert variant="destructive">
          <AlertDescription>{run.failure_reason}</AlertDescription>
        </Alert>
      ) : null}
      {monitorMessage ? (
        <Alert>
          <AlertDescription>{monitorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <p className="text-xs text-muted-foreground">刷新失败：{error}（自动重试中）</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl ring-1 ring-border">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="px-3 py-2 font-medium">关键词</th>
              <th className="px-3 py-2 font-medium">状态</th>
              {asins.map((asin) => (
                <th key={asin} className="px-3 py-2 font-mono text-xs font-medium">{asin}</th>
              ))}
              <th className="px-3 py-2 font-medium">快照</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <ResultRow key={row.id} row={row} asins={asins} runId={run.id} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        运行状态：{RUN_STATUS_TEXT[run.status]} · 站点 {run.site} · 邮编 {run.zip_code} ·
        开始于 {formatTime(run.started_at)}
        {run.ended_at ? ` · 结束于 ${formatTime(run.ended_at)}` : ''}
      </p>
    </div>
  );
}

function ResultRow({ row, asins, runId }: { row: ResultDto; asins: string[]; runId: string }) {
  const rankByAsin = new Map(row.matches.map((m) => [m.asin.toUpperCase(), m.rank]));
  return (
    <tr className="border-b last:border-0 hover:bg-muted/20">
      <td className="px-3 py-2">{row.keyword}</td>
      <td className="px-3 py-2">
        <StatusBadge kind="keyword" status={row.status} title={row.error_message} />
      </td>
      {asins.map((asin) => {
        const rank = rankByAsin.get(asin);
        return (
          <td key={asin} className="px-3 py-2">
            {rank ? (
              <Badge className="tabular-nums">#{rank}</Badge>
            ) : row.status === 'ok' ? (
              <span className="text-xs text-muted-foreground">前20外</span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </td>
        );
      })}
      <td className="px-3 py-2">
        {row.snapshot_path ? (
          <a
            href={api.snapshotUrl(runId, row.id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            查看
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
