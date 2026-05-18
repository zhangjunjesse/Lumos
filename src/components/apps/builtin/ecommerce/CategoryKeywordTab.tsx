'use client';

import * as React from 'react';
import { ArrowLeft, Loader2, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { KeywordRunList, type RunRow } from './category-keyword/KeywordRunList';
import { KeywordReportPanel } from './category-keyword/KeywordReportPanel';
import { NewResearchDialog } from './category-keyword/NewResearchDialog';
import { isNonTerminal } from './category-keyword/run-status';

const API = '/api/apps/builtin/ecommerce/keyword-research';

type View = { mode: 'list' } | { mode: 'detail'; id: string };

export function CategoryKeywordTab(): React.ReactElement {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [runs, setRuns] = React.useState<RunRow[]>([]);
  const [view, setView] = React.useState<View>({ mode: 'list' });
  const [reportMd, setReportMd] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // 列表取数态：首屏未回来时显"加载中"而非误报"没有任务"；首载失败显
  // 错误+重试而非永远空白。已成功过则轮询瞬断保留旧数据，不闪错。
  const [loadState, setLoadState] = React.useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const loadedOnceRef = React.useRef(false);
  // 竞态守卫：快速切换报告时只渲染最新一次请求的结果。
  const reqRef = React.useRef(0);

  const loadRuns = React.useCallback(async () => {
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json().catch(() => ({}))) as { runs?: RunRow[] };
      setRuns(json.runs ?? []);
      loadedOnceRef.current = true;
      setLoadState('ready');
    } catch {
      // 首载失败 → 显式 error；已成功过 → 保留旧数据（瞬断不闪错）。
      if (!loadedOnceRef.current) setLoadState('error');
    }
  }, []);

  const openReport = React.useCallback(async (id: string, silent = false) => {
    const token = (reqRef.current += 1);
    if (!silent) setReportMd(null);
    try {
      const res = await fetch(`${API}/${id}`, { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as {
        report_markdown?: string | null;
      };
      if (reqRef.current !== token) return; // 更晚的点击已接管
      setReportMd(json.report_markdown ?? null);
    } catch {
      if (reqRef.current === token) setReportMd('报告读取失败');
    }
  }, []);

  const activeId = view.mode === 'detail' ? view.id : null;
  const activeRun = activeId ? runs.find((r) => r.id === activeId) ?? null : null;
  const activeStatus = activeRun?.status ?? null;

  React.useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // 有非终态任务时轮询列表（实时进度由 activeRun 自身驱动）。
  React.useEffect(() => {
    if (!runs.some((r) => isNonTerminal(r.status))) return;
    const t = setInterval(() => void loadRuns(), 3000);
    return () => clearInterval(t);
  }, [runs, loadRuns]);

  // 打开的任务进入终态后自动刷新报告（完成→正文；取消/失败也可能有部分结果）。
  React.useEffect(() => {
    if (activeId && activeStatus && !isNonTerminal(activeStatus))
      void openReport(activeId, true);
  }, [activeId, activeStatus, openReport]);

  function openDetail(id: string): void {
    setView({ mode: 'detail', id });
    void openReport(id);
  }

  function backToList(): void {
    setView({ mode: 'list' });
    setReportMd(null);
    setConfirmId(null);
  }

  function toggleExpanded(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function start(): Promise<void> {
    setStarting(true);
    setErr(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryIds: [...selected] }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!res.ok || !json.id) throw new Error(json.error ?? '启动失败');
      setDialogOpen(false);
      setSelected(new Set());
      await loadRuns();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '启动失败');
    } finally {
      setStarting(false);
    }
  }

  async function stop(id: string): Promise<void> {
    setBusyId(id);
    try {
      await fetch(`${API}/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      await loadRuns();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusyId(id);
    try {
      await fetch(`${API}/${id}`, { method: 'DELETE' });
      setConfirmId(null);
      if (view.mode === 'detail' && view.id === id) backToList();
      await loadRuns();
    } finally {
      setBusyId(null);
    }
  }

  if (view.mode === 'detail') {
    const live = !!activeStatus && isNonTerminal(activeStatus);
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={backToList}>
            <ArrowLeft className="size-4" />
            <span className="ml-1">返回任务列表</span>
          </Button>
          {live && activeId ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busyId === activeId}
              title="停止（保留记录）"
              onClick={() => void stop(activeId)}
            >
              {busyId === activeId ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5 fill-current" />
              )}
              <span className="ml-1">停止</span>
            </Button>
          ) : null}
        </div>
        <KeywordReportPanel run={activeRun} reportMd={reportMd} />
      </div>
    );
  }

  return (
    <>
      <KeywordRunList
        runs={runs}
        loadState={loadState}
        busyId={busyId}
        confirmId={confirmId}
        onNew={() => {
          setErr(null);
          setDialogOpen(true);
        }}
        onRefresh={() => void loadRuns()}
        onOpen={openDetail}
        onStop={(id) => void stop(id)}
        onAskDelete={setConfirmId}
        onConfirmDelete={(id) => void remove(id)}
        onCancelDelete={() => setConfirmId(null)}
      />
      <NewResearchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        selected={selected}
        expanded={expanded}
        starting={starting}
        err={err}
        onSelectionChange={setSelected}
        onExp={toggleExpanded}
        onClear={() => setSelected(new Set())}
        onStart={() => void start()}
      />
    </>
  );
}
