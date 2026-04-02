'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RunOutputRenderer } from '@/components/workflow/RunOutputRenderer';
import { OutputFilesSection } from '@/components/workflow/OutputFilesSection';

interface RunRecord {
  id: string;
  scheduleId: string;
  sessionId: string | null;
  status: 'running' | 'success' | 'error';
  error: string;
  startedAt: string;
  completedAt: string | null;
}

interface DbMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface OutputFile {
  name: string;
  stepId: string;
  agentName: string;
  content: string;
  sizeBytes: number;
  createdAt?: string;
}

const STATUS_CFG = {
  success: { label: '执行成功', cls: 'bg-green-500/10 text-green-700 border-green-500/20' },
  error: { label: '执行失败', cls: 'bg-red-500/10 text-red-700 border-red-500/20' },
  running: { label: '执行中', cls: 'bg-blue-500/10 text-blue-700 border-blue-500/20 animate-pulse' },
} as const;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function durationLabel(start: string, end: string | null): string {
  if (!end) return '进行中...';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins < 60) return `${mins}m${secs}s`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

function extractParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return typeof val === 'string' ? val : '';
}

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const scheduleId = extractParam(params.id);
  const runId = extractParam(params.runId);

  const [run, setRun] = useState<RunRecord | null>(null);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!runId || !scheduleId) {
      setError(`参数缺失: scheduleId=${scheduleId}, runId=${runId}`);
      setLoading(false);
      return;
    }
    try {
      const url = `/api/workflow/schedules/${scheduleId}/runs/${runId}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || `请求失败 (${res.status})`);
        setLoading(false);
        return;
      }
      const data = await res.json() as { run?: RunRecord; messages?: DbMessage[]; outputFiles?: OutputFile[] };
      if (data.run) setRun(data.run);
      if (data.messages) setMessages(data.messages);
      if (data.outputFiles) setOutputFiles(data.outputFiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally { setLoading(false); }
  }, [scheduleId, runId]);

  useEffect(() => { void load(); }, [load]);

  const isRunning = run?.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    pollRef.current = setInterval(() => { void load(); }, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isRunning, load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />)}
      </div>
    );
  }

  if (!run) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 text-center text-muted-foreground space-y-2">
        <p>执行记录不存在</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button variant="outline" className="mt-4" onClick={() => router.push(`/workflow/schedules/${scheduleId}`)}>
          返回定时任务
        </Button>
      </div>
    );
  }

  const cfg = STATUS_CFG[run.status] ?? STATUS_CFG.running;
  const assistantCount = messages.filter(m => m.role === 'assistant').length;
  const hasOutputFiles = outputFiles.length > 0;
  const defaultTab = hasOutputFiles ? 'results' : 'process';

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button onClick={() => router.push('/workflow/schedules')} className="hover:text-foreground transition-colors">
          定时任务
        </button>
        <span>/</span>
        <button onClick={() => router.push(`/workflow/schedules/${scheduleId}`)} className="hover:text-foreground transition-colors">
          任务详情
        </button>
        <span>/</span>
        <span className="text-foreground">执行记录</span>
      </div>

      {/* Run header */}
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <Badge className={`border text-xs px-2 py-0.5 ${cfg.cls}`}>{cfg.label}</Badge>
              <span className="text-xs text-muted-foreground font-mono">{run.id.slice(0, 8)}</span>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
              <div>
                <span className="text-muted-foreground">开始时间</span>
                <div className="font-medium">{formatDateTime(run.startedAt)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">完成时间</span>
                <div className="font-medium">{run.completedAt ? formatDateTime(run.completedAt) : '--'}</div>
              </div>
              <div>
                <span className="text-muted-foreground">总耗时</span>
                <div className="font-medium">{durationLabel(run.startedAt, run.completedAt)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">会话 ID</span>
                <div className="font-mono text-xs">{run.sessionId ? `${run.sessionId.slice(0, 12)}...` : '--'}</div>
              </div>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => void load()} className="shrink-0">
            刷新
          </Button>
        </div>

        {run.error && (
          <div className="mt-3 text-sm text-destructive bg-destructive/5 rounded-lg px-3 py-2 break-words">
            {run.error}
          </div>
        )}
      </div>

      {/* Tabs: results / execution process */}
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="results" disabled={!hasOutputFiles}>
            结果文件
            {hasOutputFiles && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">
                {outputFiles.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="process">
            执行过程
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">
              {assistantCount}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="results">
          {hasOutputFiles ? (
            <OutputFilesSection files={outputFiles} />
          ) : (
            <div className="text-center py-16 text-sm text-muted-foreground rounded-xl border border-dashed border-border/50">
              暂无结果文件
            </div>
          )}
        </TabsContent>

        <TabsContent value="process">
          {isRunning && assistantCount === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground rounded-xl border border-dashed border-border/50">
              <div className="inline-block w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-2" />
              <div>正在执行，等待步骤输出...</div>
            </div>
          )}
          <RunOutputRenderer messages={messages} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
