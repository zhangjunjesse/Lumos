'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { StepTraceEvent } from '@/lib/workflow/step-trace-stream';

const KIND_CFG: Record<StepTraceEvent['kind'], { label: string; cls: string }> = {
  text:        { label: '输出',   cls: 'bg-slate-500/10 text-slate-700 border-slate-500/20' },
  thinking:    { label: '思考',   cls: 'bg-purple-500/10 text-purple-700 border-purple-500/20' },
  tool_use:    { label: '调用',   cls: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
  tool_result: { label: '结果',   cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch { return '--:--:--'; }
}

function TraceRow({ event }: { event: StepTraceEvent }) {
  const cfg = KIND_CFG[event.kind];
  const errorCls = event.kind === 'tool_result' && event.isError
    ? 'border-red-500/30 bg-red-500/5'
    : 'border-border/40 bg-muted/20';
  return (
    <div className={`rounded-lg border px-3 py-2 ${errorCls}`}>
      <div className="flex items-center gap-2 mb-1 text-[10px]">
        <span className="font-mono text-muted-foreground">{fmtTime(event.t)}</span>
        <Badge className={`border text-[10px] px-1.5 py-0 ${cfg.cls}`}>{cfg.label}</Badge>
        {event.name && (
          <span className="font-mono text-muted-foreground truncate">{event.name}</span>
        )}
        {event.kind === 'tool_result' && event.isError && (
          <span className="text-[10px] text-red-600 font-medium">错误</span>
        )}
      </div>
      {event.kind === 'tool_use' && event.inputPreview && (
        <pre className="text-[11px] leading-[1.5] font-mono whitespace-pre-wrap break-all text-muted-foreground max-h-32 overflow-auto">{event.inputPreview}</pre>
      )}
      {event.text && (
        <pre className="text-[11px] leading-[1.55] whitespace-pre-wrap break-words font-normal max-h-64 overflow-auto">{event.text}</pre>
      )}
    </div>
  );
}

/**
 * Live trace view for a single step. Shows text / thinking / tool_use /
 * tool_result blocks in arrival order. Auto-scrolls to the latest event while
 * new events arrive unless the user has scrolled up to inspect history.
 */
export function StepTraceStreamSection({
  events, isRunning, title = '实时执行流',
}: {
  events?: StepTraceEvent[];
  isRunning: boolean;
  title?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoStick, setAutoStick] = useState(true);
  const count = events?.length ?? 0;

  useEffect(() => {
    if (!autoStick || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [count, autoStick]);

  if (count === 0) {
    if (!isRunning) return null;
    return (
      <div className="rounded-lg border border-dashed border-border/50 bg-muted/10 px-3 py-4 text-xs text-muted-foreground text-center">
        <span className="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin align-middle mr-2" />
        等待 agent 开始输出...
      </div>
    );
  }

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">
          {title} · {count} 条
          {isRunning && (
            <span className="ml-2 inline-flex items-center gap-1 text-blue-600">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> 正在运行
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAutoStick((x) => !x)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {autoStick ? '已自动跟随最新' : '已暂停跟随'}
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
          setAutoStick(atBottom);
        }}
        className="max-h-[520px] overflow-auto space-y-1.5 pr-1"
      >
        {events!.map((e, i) => <TraceRow key={i} event={e} />)}
      </div>
    </section>
  );
}
