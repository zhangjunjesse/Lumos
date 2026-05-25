'use client';

import * as React from 'react';
import type { RadarStepRow, StepId } from '@/lib/etsy-erank/types';
import { useEtsyErankHealth } from './HealthBanner';

// 各 step 跑步依赖的环境
const STEP_DEPS: Record<StepId, { adspower?: boolean; llm?: boolean }> = {
  huntground: {},
  seed: { adspower: true },
  converge: { adspower: true },
  verify: { adspower: true },
  score: { llm: true },
  analyze: { adspower: true, llm: true },
  manual: {},
};

interface LogEntry {
  id: number;
  stepId: StepId;
  ts: number;
  level: 'info' | 'warn' | 'error' | string;
  message: string;
}

const STATE_LABEL: Record<RadarStepRow['state'], string> = {
  pending: '待跑',
  running: '运行中',
  blocked: '阻塞',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const STATE_CLS: Record<RadarStepRow['state'], string> = {
  pending: 'bg-muted text-muted-foreground ring-border',
  running: 'bg-amber-500/10 text-amber-700 ring-amber-500/30 animate-pulse',
  blocked: 'bg-stone-500/10 text-stone-700 ring-stone-500/30',
  done: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30',
  failed: 'bg-red-500/10 text-red-700 ring-red-500/30',
  skipped: 'bg-muted text-muted-foreground ring-border',
};

interface StepRunPanelProps {
  runId: string;
  stepId: StepId;
  step: RadarStepRow | null;
  runButtonLabel: string;
  /** done 状态下按钮文案;默认"重跑",续跑型 step(如 ④)传"续跑" */
  rerunButtonLabel?: string;
  startConfirm?: string;
  startBody?: Record<string, unknown>;
  /** 自定义 POST 路径,默认 /api/apps/builtin/etsy-erank/runs/<id>/<stepId> */
  startPath?: string;
  onStarted?: () => void;
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function StepRunPanel({ runId, stepId, step, runButtonLabel, rerunButtonLabel, startConfirm, startBody, startPath, onStarted }: StepRunPanelProps): React.ReactElement {
  const state = step?.state ?? 'pending';
  const isRunning = state === 'running';
  const isDone = state === 'done';
  const isFailed = state === 'failed';

  const [submitting, setSubmitting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = React.useState(false);
  const lastTsRef = React.useRef<number>(0);

  // health 检查 — 缺哪个依赖就把按钮禁掉,避免烧资源后才报错
  const { health } = useEtsyErankHealth();
  const deps = STEP_DEPS[stepId];
  const missingDeps: string[] = [];
  if (health) {
    if (deps.adspower && !health.adspower.available) missingDeps.push('AdsPower');
    if (deps.llm && !health.llm.available) missingDeps.push('LLM');
  }
  const blockedByHealth = missingDeps.length > 0;

  // 跑步中或刚跑完时拉日志(轮询)
  React.useEffect(() => {
    if (!isRunning && !isDone && !isFailed) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const url = `/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/logs?step=${stepId}&since=${lastTsRef.current}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const j = (await res.json()) as { logs: LogEntry[] };
        if (cancelled) return;
        if (j.logs.length > 0) {
          setLogs((cur) => [...cur, ...j.logs].slice(-300));
          lastTsRef.current = j.logs[j.logs.length - 1].ts;
        }
      } catch {
        /* ignore */
      }
    };
    pull();
    if (isRunning) {
      const t = setInterval(pull, 1500);
      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }
    return () => { cancelled = true; };
  }, [isRunning, isDone, isFailed, runId, stepId]);

  // 第一次进 done/failed 自动展开日志
  React.useEffect(() => {
    if (isFailed || isRunning) setLogsOpen(true);
  }, [isFailed, isRunning]);

  const start = async () => {
    if (startConfirm && !window.confirm(startConfirm)) return;
    setSubmitting(true);
    setStartError(null);
    try {
      const path = startPath ?? `/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/${stepId}`;
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(startBody ?? {}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      setLogs([]);
      lastTsRef.current = 0;
      onStarted?.();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const abort = async () => {
    if (!window.confirm('中断当前跑步?')) return;
    try {
      await fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/${stepId}`, { method: 'DELETE' });
    } catch (err) {
      alert(`中断失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 ring-1 ${STATE_CLS[state]}`}>{STATE_LABEL[state]}</span>
        {step && step.progressTotal > 0 && (
          <span className="text-muted-foreground tabular-nums">
            {step.progressDone} / {step.progressTotal}
          </span>
        )}
        {step?.errorMessage && (
          <span className="truncate text-red-700" title={step.errorMessage}>
            {step.errorMessage.slice(0, 100)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isRunning ? (
            <button type="button" onClick={abort} className="rounded px-2 py-1 text-[11px] ring-1 ring-border hover:bg-muted">
              中断
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={submitting || blockedByHealth}
              title={blockedByHealth ? `依赖未就绪:${missingDeps.join(' + ')}` : undefined}
              className="rounded bg-foreground px-3 py-1 text-[11px] font-medium text-background disabled:opacity-40"
            >
              {submitting ? '提交…' : blockedByHealth ? `${missingDeps.join('+')} 未就绪` : (isDone || isFailed) ? (rerunButtonLabel ?? '重跑') : runButtonLabel}
            </button>
          )}
          {logs.length > 0 && (
            <button type="button" onClick={() => setLogsOpen(!logsOpen)} className="text-muted-foreground hover:text-foreground">
              {logsOpen ? '收起日志' : `查看日志 (${logs.length})`}
            </button>
          )}
        </div>
      </div>

      {startError && (
        <div className="mt-2 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-700 ring-1 ring-red-500/30">
          启动失败:{startError}
        </div>
      )}

      {logsOpen && logs.length > 0 && (
        <div className="mt-2 max-h-48 overflow-auto rounded bg-muted/30 p-2 font-mono text-[10px] leading-relaxed">
          {logs.map((l) => (
            <div
              key={l.id}
              className={l.level === 'error' ? 'text-red-700' : l.level === 'warn' ? 'text-amber-700' : 'text-muted-foreground'}
            >
              <span className="text-[9px] opacity-60">{fmtClock(l.ts)}</span>{' '}
              <span className={l.level === 'info' ? 'text-foreground' : ''}>{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
