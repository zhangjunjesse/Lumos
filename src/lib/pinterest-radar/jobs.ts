// In-flight job registry — 每个 (runId, stepId) 至多一个,挂 globalThis 撑过 HMR

import type { StepId } from './types';

interface JobRecord {
  runId: string;
  stepId: StepId;
  startedAt: number;
  abortController: AbortController;
}

const globalKey = '__lumos_pinterest_radar_jobs__';
type Holder = { jobs: Map<string, JobRecord> };
const g = globalThis as unknown as Record<string, Holder | undefined>;
if (!g[globalKey]) g[globalKey] = { jobs: new Map() };
const jobs = (g[globalKey] as Holder).jobs;

function key(runId: string, stepId: StepId): string { return `${runId}:${stepId}`; }

export function registerJob(runId: string, stepId: StepId): AbortController {
  const k = key(runId, stepId);
  if (jobs.has(k)) throw new Error(`job already running: ${k}`);
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

export function listActiveJobKeys(): Set<string> {
  return new Set(jobs.keys());
}
