'use client';

// 右下角常驻「任务」按钮(叠在创作助手上方)。一键出品不再弹框,任务进这里。
// 有运行中任务显红点计数;点开是任务列表 → 选一个看分步进度(SopRunGrid)。轮询保持状态新鲜。

import { useCallback, useEffect, useState } from 'react';
import { etsyForgeApi, type SopRun } from './api-client';
import { SopRunGrid } from './tabs/SopRunGrid';

const STATUS_LABEL: Record<SopRun['status'], string> = {
  running: '进行中',
  success: '全部完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
};
const STATUS_COLOR: Record<SopRun['status'], string> = {
  running: 'text-blue-600',
  success: 'text-emerald-600',
  partial: 'text-amber-600',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
};

type FissionRun = { run_id: string; title: string; stage_cn: string; expected: number; started_at: string };

export function SopTaskDock() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<SopRun[]>([]);
  const [fissionRuns, setFissionRuns] = useState<FissionRun[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, f] = await Promise.all([etsyForgeApi.listSopRuns(), etsyForgeApi.listFissionRuns()]);
      setRuns(r.runs);
      setFissionRuns(f.runs);
    } catch {
      /* 忽略:列表拉取失败不打扰 */
    }
  }, []);

  // 一键出品发起时刷新列表(不自动弹框,只让红点/列表更新)。
  useEffect(() => {
    // load 内 await 后才 setState(微任务、非同步级联渲染)。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onStarted = () => void load();
    window.addEventListener('etsy-sop-started', onStarted);
    return () => window.removeEventListener('etsy-sop-started', onStarted);
  }, [load]);

  // 有运行中任务时轮询,跑完自动降频(无运行也每 15s 兜底刷新一次)。裂变运行全是 running。
  const runningCount = runs.filter((r) => r.status === 'running').length + fissionRuns.length;
  useEffect(() => {
    const t = setInterval(() => void load(), runningCount > 0 ? 3000 : 15000);
    return () => clearInterval(t);
  }, [runningCount, load]);

  const selectedRun = runs.find((r) => r.id === selected);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="absolute bottom-[4.75rem] right-4 z-50 flex items-center gap-1.5 rounded-full border bg-card px-3.5 py-2 text-sm font-medium shadow-lg hover:bg-muted"
      >
        任务
        {runningCount > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white">{runningCount}</span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-[4.75rem] right-4 z-50 flex h-[60vh] max-h-[600px] w-[clamp(360px,42vw,720px)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              {selected && (
                <button type="button" onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                  ← 返回
                </button>
              )}
              <span>{selected ? '一键出品 · 进度' : '任务'}</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">
              收起
            </button>
          </div>

          <div className="flex-1 overflow-auto p-3">
            {selected && selectedRun ? (
              <SopRunGrid runId={selected} />
            ) : runs.length === 0 && fissionRuns.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">还没有任务。去「已采集商品」选商品点「一键出品」，或在图库点「裂变」。</p>
            ) : (
              <ul className="space-y-1.5">
                {fissionRuns.map((f) => (
                  <li key={f.run_id}>
                    <div className="flex w-full items-center justify-between rounded-md border border-violet-300 px-3 py-2 text-left text-xs">
                      <span className="line-clamp-1 text-muted-foreground" title={f.title}>
                        裂变 · {f.title} · {f.stage_cn} {f.expected} 张 · {new Date(f.started_at).toLocaleString()}
                      </span>
                      <span className="shrink-0 font-medium text-violet-600">生成中 …</span>
                    </div>
                  </li>
                ))}
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(r.id)}
                      className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs hover:bg-muted"
                    >
                      <span className="text-muted-foreground">
                        一键出品 · {r.total} 个商品 · {new Date(r.started_at).toLocaleString()}
                      </span>
                      <span className={`shrink-0 font-medium ${STATUS_COLOR[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                        {r.status === 'running' && ' …'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
