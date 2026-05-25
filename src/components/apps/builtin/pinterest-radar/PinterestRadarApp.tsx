'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText, ExternalLink, Copy, RotateCw, Trash2 } from 'lucide-react';

import type { PinterestRunRow, PinterestStepRow, StepId } from '@/lib/pinterest-radar/types';
import { NewRunDialog } from './NewRunDialog';

const STEP_LABELS: Record<StepId, string> = {
  huntground: '① 圈猎场',
  collect: '② Trending 采集',
  metrics: '③ Metrics 拉取',
  analyze: '④ AI 解读',
  etsy_listings: '⑤ Etsy listing 抓取',
  report: '⑥ 报告输出',
};

export function PinterestRadarApp(): React.ReactElement {
  const [runs, setRuns] = React.useState<PinterestRunRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const [newRunOpen, setNewRunOpen] = React.useState(false);

  const loadRuns = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/apps/builtin/pinterest-radar/runs', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { runs } = (await res.json()) as { runs: PinterestRunRow[] };
      setRuns(runs);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadRuns(); }, [loadRuns]);

  const openedRun = React.useMemo(() => runs.find((r) => r.id === openRunId) ?? null, [runs, openRunId]);

  const deleteRun = React.useCallback(async (id: string, label: string) => {
    if (!window.confirm(`确认删除「${label}」?\n\n会停止该轮所有正在跑的 step,并清除所有 trending / metrics / listings / 报告记录。无法撤销。`)) return;
    try {
      const res = await fetch(`/api/apps/builtin/pinterest-radar/runs/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      if (openRunId === id) setOpenRunId(null);
      await loadRuns();
    } catch (e) {
      alert(`删除失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadRuns, openRunId]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/apps" className="text-xs text-muted-foreground hover:text-foreground">← 应用</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Pinterest 选品雷达</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            从 Pinterest Trends 当下 trending 词出发,90 天增长曲线 + AI 选品解读 + PDF 报告
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewRunOpen(true)}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          新开一轮
        </button>
      </header>

      {openedRun ? (
        <CurrentRunPanel
          run={openedRun}
          onClose={() => setOpenRunId(null)}
          onReload={loadRuns}
          onDelete={() => deleteRun(openedRun.id, openedRun.label)}
        />
      ) : (
        <RunsList runs={runs} loading={loading} onOpen={setOpenRunId} onDelete={deleteRun} />
      )}

      {newRunOpen && (
        <NewRunDialog
          onClose={() => setNewRunOpen(false)}
          onCreated={(runId) => {
            setNewRunOpen(false);
            void loadRuns();
            setOpenRunId(runId);
          }}
        />
      )}
    </div>
  );
}

function RunsList({
  runs, loading, onOpen, onDelete,
}: {
  runs: PinterestRunRow[];
  loading: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}): React.ReactElement {
  if (loading) return <div className="rounded-2xl bg-card p-8 ring-1 ring-border text-sm text-muted-foreground">加载中…</div>;
  if (runs.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-12 ring-1 ring-border text-center">
        <p className="text-base font-medium">还没有任何轮次</p>
        <p className="mt-2 text-sm text-muted-foreground">点右上「新开一轮」选猎场 → ②③④⑤ 自动跑到报告</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {runs.map((r) => (
        <div
          key={r.id}
          className="group flex items-center gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-border hover:ring-foreground/40"
        >
          <button
            type="button"
            onClick={() => onOpen(r.id)}
            className="flex flex-1 items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {r.config.country} · {r.config.preset} · {new Date(r.startedAt).toLocaleString('zh-CN')}
              </p>
            </div>
            <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              <p>{r.trendingCount} 词 · {r.analyzedCount} 已解读</p>
              <p className="mt-0.5">{r.status}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(r.id, r.label); }}
            className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
            title="删除此轮"
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>
  );
}

interface LogLine {
  id: number;
  stepId: StepId;
  ts: number;
  level: string;
  message: string;
}

// 哪些 step 重跑需要二次确认(耗时 / 耗钱)
const STEP_RERUN_CONFIRM: Partial<Record<StepId, string>> = {
  collect: '② 重跑会重新调 Pinterest API 抓 trending 词列表(~10s),已有 trending 数据会被覆盖。继续?',
  metrics: '③ 重跑会重新调 Pinterest /metrics API 拉 90 天数据(~1-2 分钟)。继续?',
  analyze: '④ 重跑会重新调 LLM 解读所有词,会消耗 token(~20 词 × 1 次 LLM call)。继续?',
  etsy_listings: '⑤ 重跑会清掉旧 Etsy listing 数据,重新抓 100 个 term(约 30-50 分钟,加 EHunt 等待)。继续?',
};

function CurrentRunPanel({
  run, onClose, onReload, onDelete,
}: {
  run: PinterestRunRow;
  onClose: () => void;
  onReload: () => Promise<void>;
  onDelete: () => void;
}): React.ReactElement {
  const [steps, setSteps] = React.useState<PinterestStepRow[]>([]);
  const [logs, setLogs] = React.useState<LogLine[]>([]);
  const [triggering, setTriggering] = React.useState<StepId | null>(null);
  const sinceTsRef = React.useRef(0);

  const loadSteps = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/apps/builtin/pinterest-radar/runs/${run.id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { steps } = (await res.json()) as { steps: PinterestStepRow[] };
      setSteps(steps);
    } catch { /* ignore */ }
  }, [run.id]);

  const loadLogs = React.useCallback(async () => {
    try {
      const url = `/api/apps/builtin/pinterest-radar/runs/${run.id}/logs?since=${sinceTsRef.current}&limit=300`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const { logs: newLogs } = (await res.json()) as { logs: LogLine[] };
      if (newLogs.length === 0) return;
      sinceTsRef.current = newLogs[newLogs.length - 1].ts;
      setLogs((prev) => [...prev, ...newLogs].slice(-500));
    } catch { /* ignore */ }
  }, [run.id]);

  React.useEffect(() => {
    void loadSteps();
    void loadLogs();
    const t = setInterval(() => { void loadSteps(); void loadLogs(); }, 2_500);
    return () => clearInterval(t);
  }, [loadSteps, loadLogs]);

  // 打开 PDF:Electron 调系统 PDF reader,web 环境用 API URL 新窗口打开
  const openReport = async (filePath: string, runId: string) => {
    const electronShell = (window as unknown as { electronAPI?: { shell?: { openPath?: (p: string) => Promise<string> } } }).electronAPI?.shell;
    if (electronShell?.openPath) {
      const err = await electronShell.openPath(filePath);
      if (err) alert(`打开失败:${err}`);
      return;
    }
    window.open(`/api/apps/builtin/pinterest-radar/runs/${runId}/report?file=1`, '_blank');
  };

  const copyReportPath = async (filePath: string) => {
    try {
      await navigator.clipboard.writeText(filePath);
    } catch {
      prompt('复制以下路径:', filePath);
    }
  };

  const triggerStep = async (stepId: StepId, isRerun = false) => {
    // 已 done 的 step 重跑前提示一次,避免误触烧钱/耗时
    if (isRerun) {
      const msg = STEP_RERUN_CONFIRM[stepId];
      if (msg && !window.confirm(msg)) return;
    }
    setTriggering(stepId);
    try {
      const res = await fetch(`/api/apps/builtin/pinterest-radar/runs/${run.id}/steps/${stepId}`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      // 立即拉一次,UI 反映 running 状态
      await loadSteps();
    } catch (e) {
      alert(`触发 ${stepId} 失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTriggering(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">← 返回轮次列表</button>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => { void onReload(); void loadSteps(); }} className="text-xs text-muted-foreground hover:text-foreground">刷新</button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
          >
            <Trash2 className="size-3" strokeWidth={1.75} />
            删除此轮
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-lg font-semibold">{run.label}</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs tabular-nums text-muted-foreground sm:grid-cols-4">
          <span>猎场: {run.config.preset}</span>
          <span>国家: {run.config.country}</span>
          <span>品类: {run.config.category || '全类目'}</span>
          <span>采集上限: {run.config.collectLimit}</span>
          <span>Metrics 天数: {run.config.metricsDays}</span>
          <span>级联至: {run.config.cascadeTo}</span>
          <span>浏览器: {run.config.browserContextId ?? '默认'}</span>
          <span>状态: {run.status}</span>
        </div>
      </div>

      <div className="space-y-2">
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">step 加载中…</p>
        ) : (
          steps.map((s) => {
            const reportPath = s.stepId === 'report' && s.state === 'done' ? String(s.meta?.filePath ?? '') : '';
            const sizeMB = s.stepId === 'report' && typeof s.meta?.sizeBytes === 'number'
              ? (Number(s.meta.sizeBytes) / 1024 / 1024).toFixed(2) : '';
            const termCount = s.stepId === 'report' && typeof s.meta?.termCount === 'number' ? Number(s.meta.termCount) : 0;

            // ⑤ 报告产出 — 独立大卡片,Lumos 黑白主调 + emerald 成功语义
            if (reportPath) {
              return (
                <div
                  key={s.stepId}
                  className="rounded-xl bg-emerald-500/5 px-4 py-4 ring-1 ring-emerald-500/20"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                      <FileText className="size-5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{STEP_LABELS[s.stepId]}</p>
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">已生成</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium" title={reportPath}>
                        {reportPath.split('/').pop()}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {termCount} 个关键词 · {sizeMB} MB
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openReport(reportPath, run.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
                    >
                      <ExternalLink className="size-3.5" strokeWidth={2} />
                      打开 PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyReportPath(reportPath)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={reportPath}
                    >
                      <Copy className="size-3.5" strokeWidth={2} />
                      复制路径
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      disabled={triggering === s.stepId}
                      onClick={() => void triggerStep(s.stepId)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <RotateCw className="size-3" strokeWidth={2} />
                      重新生成
                    </button>
                  </div>
                </div>
              );
            }

            // ⑤ etsy_listings 完成时显示 EHunt 命中 chip
            const ehuntChip = s.stepId === 'etsy_listings' && s.state === 'done'
              ? (() => {
                  const hits = Number(s.meta?.ehuntHits ?? 0);
                  const total = Number(s.meta?.totalListings ?? 0);
                  if (total === 0) return null;
                  const isOk = hits > 0;
                  return (
                    <span
                      className={isOk
                        ? 'rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700'
                        : 'rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700'}
                      title={isOk ? `EHunt 在 ${hits} 个 listing 上注入了销量/收藏数据` : '在 AdsPower profile 装 EHunt 扩展可解锁销量数据'}
                    >
                      EHunt {hits}/{total}{isOk ? '' : ' · 未启用'}
                    </span>
                  );
                })()
              : null;

            return (
              <div key={s.stepId} className="flex items-center justify-between rounded-xl bg-card px-4 py-3 ring-1 ring-border">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{STEP_LABELS[s.stepId]}</p>
                    {ehuntChip}
                  </div>
                  {s.errorMessage && (
                    <p className="mt-1 text-xs text-red-600">{s.errorMessage}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-right text-xs tabular-nums text-muted-foreground">
                  {s.progressTotal > 0 && <span>{s.progressDone}/{s.progressTotal}</span>}
                  <span className={s.state === 'done' ? 'text-emerald-600' : s.state === 'failed' ? 'text-red-600' : s.state === 'running' ? 'text-blue-600' : ''}>
                    {s.state}
                  </span>
                  {s.stepId !== 'huntground' && (
                    <button
                      type="button"
                      disabled={s.state === 'running' || triggering === s.stepId}
                      onClick={() => void triggerStep(s.stepId, s.state === 'done')}
                      className="rounded-md border px-2 py-1 hover:bg-muted disabled:opacity-40"
                    >
                      {triggering === s.stepId ? '触发中…' : s.state === 'done' ? '重跑' : '跑'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-2xl bg-card ring-1 ring-border">
        <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">执行日志</div>
        <div className="max-h-80 overflow-auto px-4 py-2 font-mono text-[11px] leading-5">
          {logs.length === 0 ? (
            <p className="text-muted-foreground">暂无日志</p>
          ) : logs.map((l) => (
            <div key={l.id} className={l.level === 'error' ? 'text-red-600' : l.level === 'warn' ? 'text-amber-700' : 'text-foreground/80'}>
              <span className="text-muted-foreground">[{l.stepId}]</span> {l.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
