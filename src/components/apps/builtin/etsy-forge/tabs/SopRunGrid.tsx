'use client';

// SOP 一次运行的分步进度网格(无遮罩,供右下角「任务」面板内嵌)。轮询某 run 状态,商品 × N 步(步骤定义来自后端)。
// 每步:状态色 + 成功摘要 / 失败原因(失败可单步重试,从该步起重跑后续链)。run 跑完自动停轮询。

import { useCallback, useEffect, useState } from 'react';
import { etsyForgeApi, type SopRun, type SopStep, type SopStepDef } from '../api-client';

const STATUS_STYLE: Record<SopStep['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/15 text-blue-600 animate-pulse',
  success: 'bg-emerald-500/15 text-emerald-600',
  failed: 'bg-destructive/15 text-destructive',
  skipped: 'bg-muted text-muted-foreground/60',
};

export function SopRunGrid({ runId }: { runId: string }) {
  const [run, setRun] = useState<SopRun | null>(null);
  const [steps, setSteps] = useState<SopStep[]>([]);
  const [defs, setDefs] = useState<SopStepDef[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await etsyForgeApi.getSopRun(runId);
      setRun(r.run);
      setSteps(r.steps);
      setDefs(r.stepDefs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  useEffect(() => {
    // load 内 await 后才 setState(微任务、非同步级联渲染);轮询在下方 effect。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [run, load]);

  const retry = async (productId: string, stepKey: string) => {
    try {
      await etsyForgeApi.retrySopStep(runId, productId, stepKey);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const products = [...new Set(steps.map((s) => s.product_id))];
  const byKey = (pid: string, key: string) => steps.find((s) => s.product_id === pid && s.step_key === key);

  return (
    <div className="overflow-auto">
      {error && <p className="mb-2 rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card px-2 py-1 text-left font-medium">商品</th>
            {defs.map((d) => (
              <th key={d.key} className="px-1 py-1 text-center font-medium" title={d.hint}>
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((pid) => {
            const title = byKey(pid, 'detail')?.product_title || pid;
            return (
              <tr key={pid} className="border-t">
                <td className="sticky left-0 max-w-[160px] truncate bg-card px-2 py-2" title={title}>
                  {title}
                </td>
                {defs.map((d) => {
                  const st = byKey(pid, d.key);
                  const status = st?.status ?? 'pending';
                  return (
                    <td key={d.key} className="px-1 py-2 text-center align-top">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[status]}`}>
                        {status === 'success' ? '✓' : status === 'failed' ? '✕' : status === 'running' ? '…' : status === 'skipped' ? '–' : '·'}
                      </span>
                      {st?.summary && <div className="mt-0.5 text-[9px] text-muted-foreground">{st.summary}</div>}
                      {status === 'failed' && (
                        <div className="mt-0.5 space-y-0.5">
                          <div className="line-clamp-2 text-[9px] text-destructive" title={st?.failure_reason ?? ''}>
                            {st?.failure_reason}
                          </div>
                          <button
                            type="button"
                            onClick={() => void retry(pid, d.key)}
                            className="rounded border border-destructive/40 px-1 py-0.5 text-[9px] text-destructive hover:bg-destructive/10"
                          >
                            重试
                          </button>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {products.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">准备中…</p>}
    </div>
  );
}
