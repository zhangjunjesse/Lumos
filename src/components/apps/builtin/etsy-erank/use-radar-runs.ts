'use client';

import * as React from 'react';
import type { CreateRunInput, RadarRunRow, RadarStepRow, StepId } from '@/lib/etsy-erank/types';

const RUNS_URL = '/api/apps/builtin/etsy-erank/runs';

interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

async function jsonOrThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j?.error ?? text;
    } catch {
      // ignore
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 拉所有轮次 — 自动每 5 秒重拉,有 in-flight job 时变 2 秒(由 caller 控制) */
export function useRadarRuns(): FetchState<RadarRunRow[]> & { refetch: () => Promise<void>; createRun: (input: CreateRunInput) => Promise<RadarRunRow>; deleteRun: (id: string) => Promise<void> } {
  const [state, setState] = React.useState<FetchState<RadarRunRow[]>>({ data: null, error: null, loading: true });

  const refetch = React.useCallback(async () => {
    try {
      const json = (await jsonOrThrow(await fetch(RUNS_URL))) as { runs: RadarRunRow[] };
      setState({ data: json.runs, error: null, loading: false });
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false }));
    }
  }, []);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  const createRun = React.useCallback(async (input: CreateRunInput): Promise<RadarRunRow> => {
    const json = (await jsonOrThrow(
      await fetch(RUNS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )) as { run: RadarRunRow };
    await refetch();
    return json.run;
  }, [refetch]);

  const deleteRun = React.useCallback(async (id: string): Promise<void> => {
    await jsonOrThrow(await fetch(`${RUNS_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    await refetch();
  }, [refetch]);

  return { ...state, refetch, createRun, deleteRun };
}

/** 拉单一 run 的详情(含 steps) */
export function useRadarRunDetail(runId: string | null, opts: { pollMs?: number } = {}): FetchState<{ run: RadarRunRow; steps: RadarStepRow[] }> & { refetch: () => Promise<void> } {
  const [state, setState] = React.useState<FetchState<{ run: RadarRunRow; steps: RadarStepRow[] }>>({ data: null, error: null, loading: !!runId });

  const refetch = React.useCallback(async () => {
    if (!runId) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    try {
      const json = (await jsonOrThrow(await fetch(`${RUNS_URL}/${encodeURIComponent(runId)}`))) as { run: RadarRunRow; steps: RadarStepRow[] };
      setState({ data: json, error: null, loading: false });
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false }));
    }
  }, [runId]);

  React.useEffect(() => {
    refetch();
    if (!opts.pollMs) return;
    const t = setInterval(refetch, opts.pollMs);
    return () => clearInterval(t);
  }, [refetch, opts.pollMs]);

  return { ...state, refetch };
}

/** 检查 step 状态是否为 running(轮询频率给个 helper) */
export function isAnyStepRunning(steps: RadarStepRow[] | null | undefined): boolean {
  if (!steps) return false;
  return steps.some((s) => s.state === 'running');
}

export function stepFor(steps: RadarStepRow[] | null | undefined, id: StepId): RadarStepRow | null {
  if (!steps) return null;
  return steps.find((s) => s.stepId === id) ?? null;
}
