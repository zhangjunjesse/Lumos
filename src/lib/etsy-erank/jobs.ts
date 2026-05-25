// 跑步 job 注册表 — 内存级,挂在 process 上以挺过 Next.js HMR 热重载
// 每个 (runId, stepId) 最多一个 in-flight job,重复触发会被 reject

import type { StepId } from './types';

interface JobRecord {
  runId: string;
  stepId: StepId;
  startedAt: number;
  abortController: AbortController;
}

const globalKey = '__lumos_etsy_erank_jobs__';
type Holder = { jobs: Map<string, JobRecord> };
const g = globalThis as unknown as Record<string, Holder | undefined>;
if (!g[globalKey]) {
  g[globalKey] = { jobs: new Map() };
}
const jobs = (g[globalKey] as Holder).jobs;

function key(runId: string, stepId: StepId): string {
  return `${runId}:${stepId}`;
}

export function registerJob(runId: string, stepId: StepId): AbortController {
  const k = key(runId, stepId);
  if (jobs.has(k)) {
    throw new Error(`job already running: ${k}`);
  }
  const ac = new AbortController();
  jobs.set(k, { runId, stepId, startedAt: Date.now(), abortController: ac });
  return ac;
}

export function unregisterJob(runId: string, stepId: StepId): void {
  jobs.delete(key(runId, stepId));
}

export function getJob(runId: string, stepId: StepId): JobRecord | undefined {
  return jobs.get(key(runId, stepId));
}

export function abortJob(runId: string, stepId: StepId): boolean {
  const job = jobs.get(key(runId, stepId));
  if (!job) return false;
  job.abortController.abort();
  jobs.delete(key(runId, stepId));
  return true;
}

export function listActiveJobs(): JobRecord[] {
  return [...jobs.values()];
}
