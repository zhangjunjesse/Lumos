'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

function extractPreviewText(content: string): string {
  try {
    const blocks = JSON.parse(content) as Array<{ type: string; text?: string }>;
    if (Array.isArray(blocks)) {
      const text = blocks
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text as string)
        .join('\n')
        .trim();
      return stripHeaderAndMarkdown(text);
    }
  } catch { /* not JSON */ }
  return content.trim();
}

/** Remove step header (new/legacy format) and markdown formatting for plain text preview. */
function stripHeaderAndMarkdown(text: string): string {
  let body = text;
  // Strip new format header: <!-- step:...:...:... -->
  body = body.replace(/^<!--\s*step:.+?-->\s*\n?/, '');
  // Strip legacy format header: **roleName** · stepId
  body = body.replace(/^\*\*(.+?)\*\*\s*·\s*\S+\s*\n/, '');
  // Strip remaining markdown
  return body
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^-\s+/gm, '  - ')
    .replace(/<sub>(.+?)<\/sub>/g, '$1')
    .replace(/---\n?/g, '')
    .trim();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function durationLabel(start: string, end: string | null): string {
  if (!end) return '进行中...';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

const STATUS_CFG = {
  success: { label: '成功', cls: 'bg-green-500/10 text-green-700 border-green-500/20' },
  error: { label: '失败', cls: 'bg-red-500/10 text-red-700 border-red-500/20' },
  running: { label: '运行中', cls: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
} as const;

function RunItem({ run, scheduleId }: { run: RunRecord; scheduleId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function loadPreview() {
    if (!run.sessionId || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/sessions/${run.sessionId}/messages?limit=10`);
      const data = await res.json() as { messages?: DbMessage[] };
      const msgs = data.messages ?? [];
      const text = msgs
        .filter(m => m.role === 'assistant')
        .map(m => extractPreviewText(m.content))
        .filter(Boolean)
        .join('\n---\n');
      setPreview(text || '暂无输出');
    } catch { setPreview('加载失败'); } finally { setLoading(false); }
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded && preview === null) void loadPreview();
    setExpanded(v => !v);
  }

  function openDetail() {
    router.push(`/workflow/schedules/${scheduleId}/runs/${run.id}`);
  }

  const cfg = STATUS_CFG[run.status] ?? STATUS_CFG.running;

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
        <Badge className={`border text-[10px] px-1.5 py-0 h-4 shrink-0 ${cfg.cls}`}>{cfg.label}</Badge>
        <span className="text-xs flex-1 min-w-0">{formatTime(run.startedAt)}</span>
        <span className="text-[10px] text-muted-foreground shrink-0">{durationLabel(run.startedAt, run.completedAt)}</span>
        <button
          className="text-xs text-primary hover:text-primary/80 transition-colors shrink-0 px-2 py-0.5 rounded hover:bg-primary/5"
          onClick={openDetail}
        >
          查看报告
        </button>
        <button
          className="text-[10px] text-muted-foreground w-4 shrink-0 hover:text-foreground transition-colors"
          onClick={toggle}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border/40 px-4 py-3 bg-muted/20">
          {run.error && (
            <div className="text-xs text-destructive bg-destructive/5 rounded px-2.5 py-2 break-words mb-2">{run.error}</div>
          )}
          {loading && <div className="text-xs text-muted-foreground py-3 text-center">加载预览...</div>}
          {!loading && preview !== null && (
            <div className="text-xs bg-background rounded-lg p-3 border border-border/30 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed text-muted-foreground">
              {preview}
            </div>
          )}
          {!loading && preview === null && !run.sessionId && (
            <div className="text-xs text-muted-foreground py-3 text-center">无会话记录</div>
          )}
          <div className="mt-2 text-right">
            <button className="text-xs text-primary hover:underline" onClick={openDetail}>
              查看完整报告 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ScheduleRunListProps {
  scheduleId: string;
}

export function ScheduleRunList({ scheduleId }: ScheduleRunListProps) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflow/schedules/${scheduleId}/runs`, { cache: 'no-store' });
      const data = await res.json() as { runs?: RunRecord[] };
      setRuns(data.runs ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [scheduleId]);

  useEffect(() => { void load(); }, [load]);

  const hasRunning = runs.some(r => r.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    pollRef.current = setInterval(() => { void load(); }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasRunning, load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">执行历史</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{runs.length} 条记录</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void load()} disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </Button>
        </div>
      </div>

      {loading && runs.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-11 rounded-lg bg-muted/40 animate-pulse" />)}
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground rounded-lg border border-dashed border-border/50">
          还没有执行记录
        </div>
      ) : (
        <div className="space-y-1.5">
          {runs.map(run => <RunItem key={run.id} run={run} scheduleId={scheduleId} />)}
        </div>
      )}
    </div>
  );
}
