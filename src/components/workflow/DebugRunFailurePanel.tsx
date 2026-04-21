'use client';

import { useEffect, useState } from 'react';

interface Failure {
  stepId: string;
  errorName: string | null;
  errorCode: string | null;
  primaryMessage: string;
  stderr: string | null;
  stack: string | null;
  outputPreview: string | null;
  cause: string | null;
  providerInfo: string | null;
  summary: string | null;
  completedAt: string;
  durationMs: number;
  hint: string | null;
}

interface FailureReport {
  runError: string;
  failures: Failure[];
}

interface Props {
  workflowId: string;
  runId: string;
  fallbackError: string;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function DetailBlock({ label, content }: { label: string; content: string }) {
  return (
    <details className="border-t border-red-500/20 pt-1">
      <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
        {label}
      </summary>
      <pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap break-words text-muted-foreground max-h-[200px] overflow-auto">
        {content}
      </pre>
    </details>
  );
}

function FailureCard({ f }: { f: Failure }) {
  const headline = f.errorName && f.errorName !== 'Error'
    ? `${f.errorName}${f.errorCode ? ` · ${f.errorCode}` : ''}`
    : (f.errorCode || null);

  return (
    <div className="rounded border border-red-500/30 bg-red-500/5 p-2 space-y-1.5">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground shrink-0">失败节点</span>
        <span className="font-mono font-medium text-foreground truncate" title={f.stepId}>{f.stepId}</span>
        {headline && (
          <span className="font-mono text-red-600 dark:text-red-400 truncate" title={headline}>
            {headline}
          </span>
        )}
        <span className="text-muted-foreground ml-auto shrink-0">{formatClock(f.completedAt)}</span>
      </div>

      <div className="text-[11px] text-red-700 dark:text-red-400 whitespace-pre-wrap break-words leading-relaxed max-h-[160px] overflow-auto">
        {f.primaryMessage}
      </div>

      {f.hint && (
        <div className="rounded bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 text-[10px] text-amber-800 dark:text-amber-300 leading-relaxed">
          <span className="font-medium">建议:</span> {f.hint}
        </div>
      )}

      {f.providerInfo && (
        <div className="text-[10px] text-muted-foreground">
          Provider: <span className="font-mono text-foreground">{f.providerInfo}</span>
        </div>
      )}

      {f.stderr && <DetailBlock label="stderr" content={f.stderr} />}
      {f.outputPreview && <DetailBlock label="output preview" content={f.outputPreview} />}
      {f.cause && <DetailBlock label="cause" content={f.cause} />}
      {f.stack && <DetailBlock label="stack" content={f.stack} />}
      {f.summary && <DetailBlock label="summary" content={f.summary} />}
    </div>
  );
}

export function DebugRunFailurePanel({ workflowId, runId, fallbackError }: Props) {
  const [data, setData] = useState<FailureReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/workflows/${workflowId}/debug/runs/${runId}/failures`, { cache: 'no-store' })
      .then(r => r.json() as Promise<FailureReport>)
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workflowId, runId]);

  if (loading) {
    return (
      <div className="text-[10px] text-muted-foreground px-3 pb-2 pt-0.5">
        正在定位失败节点…
      </div>
    );
  }

  const failures = data?.failures ?? [];

  if (failures.length === 0) {
    return (
      <div className="px-3 pb-2 pt-0.5 space-y-1">
        <div className="text-[10px] text-muted-foreground">
          未找到具体失败节点缓存,展示 Run 级报错:
        </div>
        <pre className="text-[10px] font-mono whitespace-pre-wrap break-words rounded border border-red-500/30 bg-red-500/5 p-2 text-red-700 dark:text-red-400 max-h-[200px] overflow-auto">
          {data?.runError || fallbackError}
        </pre>
      </div>
    );
  }

  return (
    <div className="px-3 pb-2 pt-0.5 space-y-1.5">
      {failures.map(f => (
        <FailureCard key={f.stepId + f.completedAt} f={f} />
      ))}
    </div>
  );
}
