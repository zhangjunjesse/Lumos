import { buildConfigHashes, computeTransitiveDownstream } from './debug-cache';
import type { ScheduleRunStep, ScheduleRunStepSnapshot } from '@/lib/db/schedule-run-steps';
import type { DebugStepOutput } from './debug-types';
import type { StepResult, WorkflowDSLV3 } from './types';
import type { WorkflowNode } from './types-v3';

export interface ResumeStepAttemptRow {
  step_name: string;
  status: string;
  output: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export function buildCachedStepsForResume(input: {
  dsl: WorkflowDSLV3;
  attempts: ResumeStepAttemptRow[];
  sourceRunId: string;
  targetStepId: string;
}): DebugStepOutput[] {
  const configHashes = buildConfigHashes(input.dsl);
  const reusableNodeIds = computeResumeReusableNodeIds(input.dsl, input.targetStepId);
  const nodeById = buildNodeMap(input.dsl);

  const latestTerminal = new Map<string, ResumeStepAttemptRow>();
  for (const attempt of input.attempts) {
    if (!reusableNodeIds.has(attempt.step_name)) continue;
    if (!isTerminalAttemptStatus(attempt.status)) continue;
    latestTerminal.set(attempt.step_name, attempt);
  }

  const out: DebugStepOutput[] = [];
  for (const [stepId, attempt] of latestTerminal) {
    if (!isSuccessfulAttemptStatus(attempt.status)) continue;
    const parsed = parseStepResult(attempt.output);
    if (!parsed) continue;
    const node = nodeById.get(stepId);
    if (!parsed.success && !allowsFailedResultReuse(node)) continue;
    out.push({
      sessionId: `rerun:${input.sourceRunId}`,
      stepId,
      output: parsed.output,
      metadata: {
        ...(parsed.metadata ?? {}),
        fromProductionRun: true,
        sourceRunId: input.sourceRunId,
      },
      status: parsed.success ? 'success' : 'error',
      error: parsed.error,
      durationMs: computeDurationMs(attempt.started_at, attempt.finished_at),
      completedAt: attempt.finished_at ?? attempt.created_at,
      configHash: configHashes.get(stepId) ?? '',
    });
  }
  return out;
}

export function buildReusedRunStepSnapshots(input: {
  cachedSteps: DebugStepOutput[];
  sourceSteps: ScheduleRunStep[];
  dsl?: WorkflowDSLV3;
  targetStepId?: string;
}): ScheduleRunStepSnapshot[] {
  const reusableNodeIds = input.dsl && input.targetStepId
    ? computeResumeReusableNodeIds(input.dsl, input.targetStepId)
    : null;
  const sourceByStepId = new Map(input.sourceSteps.map((step) => [step.stepId, step]));
  const cachedByStepId = new Map(input.cachedSteps.map((step) => [step.stepId, step]));
  const snapshots: ScheduleRunStepSnapshot[] = [];
  const seen = new Set<string>();

  for (const source of input.sourceSteps) {
    if (reusableNodeIds && !reusableNodeIds.has(source.stepId)) continue;
    if (!isVisibleReusableRunStepStatus(source.status)) continue;
    const cached = cachedByStepId.get(source.stepId);
    snapshots.push({
      stepId: source.stepId,
      presetName: source.presetName,
      status: source.status,
      error: source.error || cached?.error || '',
      outputSummary: source.outputSummary || (cached ? summarizeStepOutput(cached.output) : ''),
      durationMs: source.durationMs ?? cached?.durationMs ?? null,
      startedAt: source.startedAt ?? null,
      completedAt: source.completedAt ?? cached?.completedAt ?? null,
    });
    seen.add(source.stepId);
  }

  for (const cached of input.cachedSteps) {
    if (seen.has(cached.stepId)) continue;
    const source = sourceByStepId.get(cached.stepId);
    snapshots.push({
      stepId: cached.stepId,
      presetName: source?.presetName ?? '',
      status: source?.status ?? (cached.status === 'success' ? 'success' : 'error'),
      error: cached.error || source?.error || '',
      outputSummary: source?.outputSummary || summarizeStepOutput(cached.output),
      durationMs: source?.durationMs ?? cached.durationMs ?? null,
      startedAt: source?.startedAt ?? null,
      completedAt: source?.completedAt ?? cached.completedAt ?? null,
    });
  }

  return snapshots;
}

export interface ResumeCacheCoverageIssue {
  stepId: string;
  reason: 'missing-output' | 'prior-step-error' | 'prior-step-not-terminal' | 'unsupported-node-type';
}

export function findResumeCacheCoverageIssues(input: {
  dsl: WorkflowDSLV3;
  targetStepId: string;
  cachedSteps: DebugStepOutput[];
  sourceSteps: ScheduleRunStep[];
}): ResumeCacheCoverageIssue[] {
  const reusableNodeIds = computeResumeReusableNodeIds(input.dsl, input.targetStepId);
  const nodeById = buildNodeMap(input.dsl);
  const cachedStepIds = new Set(input.cachedSteps.map((step) => step.stepId));
  const issues: ResumeCacheCoverageIssue[] = [];

  if (input.sourceSteps.length === 0) {
    for (const stepId of reusableNodeIds) {
      const node = nodeById.get(stepId);
      if (!isRuntimeCacheableNode(node)) continue;
      if (!cachedStepIds.has(stepId)) {
        issues.push({ stepId, reason: 'missing-output' });
      }
    }
    return issues;
  }

  for (const source of input.sourceSteps) {
    if (!reusableNodeIds.has(source.stepId)) continue;
    const node = nodeById.get(source.stepId);
    if (!node) continue;

    if (source.status === 'error') {
      issues.push({ stepId: source.stepId, reason: 'prior-step-error' });
      continue;
    }
    if (source.status === 'running' || source.status === 'pending') {
      issues.push({ stepId: source.stepId, reason: 'prior-step-not-terminal' });
      continue;
    }
    if (source.status !== 'success') continue;

    if (isRuntimeCacheableNode(node)) {
      if (!cachedStepIds.has(source.stepId)) {
        issues.push({ stepId: source.stepId, reason: 'missing-output' });
      }
      continue;
    }
    if (node.type === 'approval') {
      issues.push({ stepId: source.stepId, reason: 'unsupported-node-type' });
    }
  }

  return issues;
}

export function formatResumeCacheCoverageIssues(issues: ResumeCacheCoverageIssue[]): string {
  return issues
    .slice(0, 8)
    .map((issue) => {
      const reason = issue.reason === 'missing-output'
        ? '缺少可复用输出'
        : issue.reason === 'prior-step-error'
          ? '上游节点原状态为失败'
          : issue.reason === 'prior-step-not-terminal'
            ? '上游节点原状态未结束'
            : '节点类型暂不支持复用';
      return `${issue.stepId}（${reason}）`;
    })
    .join('、');
}

export function findFirstTerminalFailedStep(
  attempts: ResumeStepAttemptRow[],
  dsl: WorkflowDSLV3,
): string | null {
  const nodeIds = new Set(dsl.nodes.map((node) => node.id));
  const latestTerminalByStep = new Map<string, ResumeStepAttemptRow>();

  for (const attempt of attempts) {
    if (!nodeIds.has(attempt.step_name)) continue;
    if (!isTerminalAttemptStatus(attempt.status)) continue;
    latestTerminalByStep.set(attempt.step_name, attempt);
  }

  for (const attempt of attempts) {
    if (attempt.status !== 'failed') continue;
    if (latestTerminalByStep.get(attempt.step_name) === attempt) {
      return attempt.step_name;
    }
  }
  return null;
}

function parseStepResult(raw: string | null): StepResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StepResult>;
    if (!parsed || typeof parsed !== 'object' || !('success' in parsed)) return null;
    return {
      success: Boolean(parsed.success),
      output: parsed.output ?? null,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      metadata: isJsonObject(parsed.metadata) ? parsed.metadata : undefined,
    };
  } catch {
    return null;
  }
}

function computeResumeReusableNodeIds(dsl: WorkflowDSLV3, targetStepId: string): Set<string> {
  const downstream = new Set(computeTransitiveDownstream(targetStepId, dsl));
  downstream.add(targetStepId);
  const out = new Set<string>();
  for (const node of dsl.nodes) {
    if (!downstream.has(node.id)) out.add(node.id);
  }
  return out;
}

function buildNodeMap(dsl: WorkflowDSLV3): Map<string, WorkflowNode> {
  return new Map(dsl.nodes.map((node) => [node.id, node]));
}

function isRuntimeCacheableNode(node: WorkflowNode | undefined): boolean {
  return Boolean(node && (
    node.type === 'agent'
    || node.type === 'notification'
    || node.type === 'capability'
    || node.type === 'wait'
  ));
}

function allowsFailedResultReuse(node: WorkflowNode | undefined): boolean {
  return Boolean(node?.policy?.continueOnFailure);
}

function isVisibleReusableRunStepStatus(status: ScheduleRunStep['status']): boolean {
  return status === 'success' || status === 'error' || status === 'skipped';
}

function isJsonObject(value: unknown): value is NonNullable<StepResult['metadata']> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function computeDurationMs(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

function summarizeStepOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output.trim();
  }
  if (typeof output === 'number' || typeof output === 'boolean') {
    return String(output);
  }
  if (!output || typeof output !== 'object') {
    return '';
  }
  const record = output as Record<string, unknown>;
  for (const key of ['summary', 'message', 'text', 'content', 'result']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function isSuccessfulAttemptStatus(status: string): boolean {
  return status === 'completed' || status === 'succeeded';
}

function isTerminalAttemptStatus(status: string): boolean {
  return isSuccessfulAttemptStatus(status) || status === 'failed';
}
