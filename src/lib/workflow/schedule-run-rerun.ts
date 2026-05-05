import Database from 'better-sqlite3';
import path from 'path';
import { getDb } from '@/lib/db/connection';
import {
  getRunHistory,
  getScheduledWorkflow,
  getWorkflowExecutionId,
  insertRunHistory,
  recordScheduleRun,
  updateRunHistory,
  updateScheduledWorkflow,
  type ScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { hasRunningExecution } from '@/lib/db/schedule-run-steps';
import { createSession, updateSessionBrowserContext } from '@/lib/db/sessions';
import { validateBrowserContextId } from '@/lib/browser-provider/context-validation';
import { getWorkflowDataDir } from '@/lib/workflow/openworkflow-client';
import { generateWorkflowFromDsl } from '@/lib/workflow/compiler';
import { submitWorkflow } from '@/lib/workflow/api';
import { buildResumeRuntimeContext } from './debug-cache';
import {
  buildCachedStepsForResume,
  findFirstTerminalFailedStep,
  type ResumeStepAttemptRow,
} from './schedule-run-rerun-cache';
import type { WorkflowDSLV3 } from './types';

export type ScheduleRunRerunMode = 'from-failed' | 'from-step';

export interface ScheduleRunRerunRequest {
  scheduleId: string;
  runId: string;
  mode: ScheduleRunRerunMode;
  stepId?: string;
}

export interface ScheduleRunRerunResult {
  runId: string;
  sessionId: string;
  workflowRunId: string;
  startStepId: string;
  reusedStepIds: string[];
}

const CONTROL_FLOW_TYPES = new Set(['if-else', 'for-each', 'while', 'parallel', 'join', 'approval']);

export async function rerunScheduleRunFromNode(
  request: ScheduleRunRerunRequest,
): Promise<ScheduleRunRerunResult> {
  const schedule = getScheduledWorkflow(request.scheduleId);
  if (!schedule) throw new Error('任务不存在');

  const sourceRun = getRunHistory(request.runId);
  if (!sourceRun || sourceRun.scheduleId !== request.scheduleId) {
    throw new Error('执行记录不存在');
  }
  if (sourceRun.status === 'running') {
    throw new Error('当前执行还在运行，停止或等待结束后才能从节点重跑');
  }
  if (hasRunningExecution(request.scheduleId)) {
    throw new Error('这个任务已有执行在运行，先停止当前执行后再重跑节点');
  }

  const dsl = sourceRun.workflowDslSnapshot ?? schedule.workflowDsl;
  const startStepId = resolveStartStepId({ request, sourceRunId: sourceRun.sessionId ? getWorkflowExecutionId(sourceRun.sessionId) : null, dsl });
  const target = dsl.nodes.find((node) => node.id === startStepId);
  if (!target) throw new Error(`节点不存在: ${startStepId}`);
  if (CONTROL_FLOW_TYPES.has(target.type)) {
    throw new Error(`节点「${startStepId}」是流程控制节点，暂不支持直接从这里重跑；请选择它后面的实际执行节点`);
  }

  const workflowRunId = sourceRun.sessionId ? getWorkflowExecutionId(sourceRun.sessionId) : null;
  if (!workflowRunId) throw new Error('找不到原执行对应的底层 workflowRunId，无法复用上游结果');

  const attempts = loadStepAttempts(workflowRunId);
  const cachedSteps = buildCachedStepsForResume({
    dsl,
    attempts,
    sourceRunId: sourceRun.id,
    targetStepId: startStepId,
  });

  const artifact = generateWorkflowFromDsl(dsl);
  if (!artifact.validation.valid) {
    throw new Error(`DSL invalid: ${artifact.validation.errors.join('; ')}`);
  }

  const browserContextId = schedule.browserContextId;
  validateBrowserContextId(browserContextId);

  const label = `[重跑] ${schedule.name} · 从 ${startStepId}`;
  const session = createSession(label, undefined, undefined, schedule.workingDirectory || undefined, 'workflow');
  updateSessionBrowserContext(session.id, browserContextId);
  const newRunId = insertRunHistory(schedule.id, session.id, dsl, browserContextId);
  tagRunAsProductionRerun(newRunId);

  const resumeContext = buildResumeRuntimeContext({
    sessionId: `rerun:${newRunId}`,
    targetStepId: startStepId,
    dsl,
    cachedSteps,
  });

  let terminalResultHandled = false;
  try {
    const result = await submitWorkflow(
      {
        taskId: session.id,
        runHistoryId: newRunId,
        workflowCode: artifact.code,
        workflowManifest: artifact.manifest,
        inputs: {
          __lumosRuntime: {
            taskId: session.id,
            sessionId: session.id,
            workingDirectory: schedule.workingDirectory || undefined,
            browserContextId,
          },
          ...mergeParamDefaults(dsl, schedule.runParams ?? {}),
        },
      },
      buildCallbacks(schedule, newRunId),
      resumeContext,
    );

    if (result.status === 'rejected') {
      const err = (result.errors || []).join('; ');
      recordScheduleRun(schedule.id, 'error', err);
      updateRunHistory(newRunId, 'error', err);
      terminalResultHandled = true;
      throw new Error(`工作流提交失败: ${err}`);
    }

    return {
      runId: newRunId,
      sessionId: session.id,
      workflowRunId: result.workflowId,
      startStepId,
      reusedStepIds: cachedSteps.map((step) => step.stepId),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!terminalResultHandled) {
      recordScheduleRun(schedule.id, 'error', msg);
      updateRunHistory(newRunId, 'error', msg);
    }
    throw error;
  }
}

function resolveStartStepId(input: {
  request: ScheduleRunRerunRequest;
  sourceRunId: string | null;
  dsl: WorkflowDSLV3;
}): string {
  if (input.request.mode === 'from-step') {
    const stepId = input.request.stepId?.trim();
    if (!stepId) throw new Error('请选择要重跑的节点');
    return stepId;
  }

  const failed = input.sourceRunId ? findFirstFailedStep(input.sourceRunId, input.dsl) : null;
  if (!failed) throw new Error('没有找到失败节点，请手动选择要重跑的节点');
  return failed;
}

function findFirstFailedStep(workflowRunId: string, dsl: WorkflowDSLV3): string | null {
  const rows = loadStepAttempts(workflowRunId);
  return findFirstTerminalFailedStep(rows, dsl);
}

function loadStepAttempts(workflowRunId: string): ResumeStepAttemptRow[] {
  const dbPath = path.join(getWorkflowDataDir(), 'workflows.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`
      SELECT step_name, status, output, error, started_at, finished_at, created_at
      FROM step_attempts
      WHERE workflow_run_id = ?
      ORDER BY created_at ASC
    `).all(workflowRunId) as ResumeStepAttemptRow[];
  } finally {
    db.close();
  }
}

function buildCallbacks(schedule: ScheduledWorkflow, runHistoryId: string) {
  return {
    onCompleted: () => {
      recordScheduleRun(schedule.id, 'success', '');
      updateRunHistory(runHistoryId, 'success', '');
      if (schedule.runMode === 'once') {
        updateScheduledWorkflow(schedule.id, { enabled: false });
      }
    },
    onFailed: (event: { error?: { message?: string } }) => {
      const msg = event.error?.message || '工作流执行失败';
      recordScheduleRun(schedule.id, 'error', msg);
      updateRunHistory(runHistoryId, 'error', msg);
      if (schedule.runMode === 'once') {
        updateScheduledWorkflow(schedule.id, { enabled: false });
      }
    },
  };
}

function mergeParamDefaults(
  dsl: WorkflowDSLV3,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const dslParams = (dsl as { params?: Array<{ name: string; default?: unknown }> }).params;
  if (!dslParams?.length) return params;
  const merged = { ...params };
  for (const p of dslParams) {
    if (!(p.name in merged) && p.default !== undefined) {
      merged[p.name] = p.default;
    }
  }
  return merged;
}

function tagRunAsProductionRerun(runId: string): void {
  getDb().prepare(
    "UPDATE schedule_run_history SET mode = 'rerun' WHERE id = ?",
  ).run(runId);
}
