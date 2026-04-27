import {
  getRunHistory,
  getScheduledWorkflow,
  getWorkflowExecutionId,
  listRunningRunHistory,
  recordScheduleRun,
  updateScheduledWorkflow,
  updateRunHistoryStatus,
  type ScheduleRunRecord,
} from '@/lib/db/scheduled-workflows';
import { getDb } from '@/lib/db/connection';
import { cancelRunningRunSteps } from '@/lib/db/schedule-run-steps';
import { cancelWorkflow } from '@/lib/workflow/api';

export interface CancelScheduleRunResult {
  runId: string | null;
  workflowId: string | null;
  cancelled: boolean;
  message: string;
}

export interface CancelRunningScheduleRunsResult {
  cancelledRuns: CancelScheduleRunResult[];
}

function resolveWorkflowRunId(run: ScheduleRunRecord): string | null {
  return run.sessionId ? getWorkflowExecutionId(run.sessionId) : null;
}

function disableOneTimeScheduleAfterCancellation(scheduleId: string): void {
  const schedule = getScheduledWorkflow(scheduleId);
  if (schedule?.runMode === 'once' && schedule.enabled) {
    updateScheduledWorkflow(scheduleId, { enabled: false });
  }
}

function findRunningWorkflowIdsForSchedule(scheduleId: string): string[] {
  const schedule = getScheduledWorkflow(scheduleId);
  if (!schedule) return [];

  const names = Array.from(new Set([
    schedule.name,
    schedule.workflowDsl.name,
  ].map((name) => name.trim()).filter(Boolean)));
  if (names.length === 0) return [];

  const titleCandidates = names.flatMap((name) => [
    `[手动] ${name}`,
    `[一次性] ${name}`,
    `[定时] ${name}`,
  ]);

  const namePlaceholders = names.map(() => '?').join(',');
  const titlePlaceholders = titleCandidates.map(() => '?').join(',');
  const rows = getDb().prepare(`
    SELECT DISTINCT we.workflow_id
    FROM workflow_executions we
    LEFT JOIN chat_sessions cs ON cs.id = we.task_id
    WHERE we.status NOT IN ('completed', 'failed', 'cancelled')
      AND (
        we.workflow_name IN (${namePlaceholders})
        ${titleCandidates.length > 0 ? `OR cs.title IN (${titlePlaceholders})` : ''}
      )
  `).all(...names, ...titleCandidates) as Array<{ workflow_id?: string }>;

  return rows
    .map((row) => row.workflow_id)
    .filter((workflowId): workflowId is string => typeof workflowId === 'string' && workflowId.trim().length > 0);
}

async function cancelWorkflowIds(
  workflowIds: string[],
  runId: string | null,
): Promise<CancelScheduleRunResult[]> {
  const results: CancelScheduleRunResult[] = [];
  for (const workflowId of Array.from(new Set(workflowIds))) {
    try {
      const cancelled = await cancelWorkflow(workflowId);
      results.push({
        runId,
        workflowId,
        cancelled,
        message: cancelled
          ? '已向 workflow engine 发送取消请求'
          : '底层执行已不在可取消状态',
      });
    } catch (error) {
      results.push({
        runId,
        workflowId,
        cancelled: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function cancelScheduleRun(
  runId: string,
  scheduleId: string,
  reason = '用户已取消任务',
  options?: {
    updateScheduleSummary?: boolean;
  },
): Promise<CancelScheduleRunResult> {
  const run = getRunHistory(runId);
  if (!run || run.scheduleId !== scheduleId) {
    return {
      runId,
      workflowId: null,
      cancelled: false,
      message: '执行记录不存在',
    };
  }

  if (run.status !== 'running') {
    return {
      runId,
      workflowId: resolveWorkflowRunId(run),
      cancelled: false,
      message: '执行记录已经结束',
    };
  }

  const workflowIds = new Set<string>();
  const workflowId = resolveWorkflowRunId(run);
  if (workflowId) workflowIds.add(workflowId);
  for (const activeWorkflowId of findRunningWorkflowIdsForSchedule(scheduleId)) {
    workflowIds.add(activeWorkflowId);
  }

  const workflowResults = await cancelWorkflowIds(Array.from(workflowIds), run.id);
  const firstWorkflowResult = workflowResults[0];

  updateRunHistoryStatus(run.id, 'cancelled', reason);
  cancelRunningRunSteps(run.id, reason);

  if (options?.updateScheduleSummary !== false) {
    recordScheduleRun(scheduleId, 'cancelled', reason);
    disableOneTimeScheduleAfterCancellation(scheduleId);
  }

  return {
    runId: run.id,
    workflowId: firstWorkflowResult?.workflowId ?? workflowId,
    cancelled: workflowResults.some((result) => result.cancelled),
    message: workflowResults.length > 0
      ? workflowResults.map((result) => result.message).join('; ')
      : '执行记录已标记为取消；未找到关联的 workflowRunId',
  };
}

export async function cancelRunningScheduleRuns(
  scheduleId: string,
  reason = '用户已取消任务',
  options?: {
    updateScheduleSummary?: boolean;
  },
): Promise<CancelRunningScheduleRunsResult> {
  const runningRuns = listRunningRunHistory(scheduleId);
  const cancelledRuns: CancelScheduleRunResult[] = [];

  for (const run of runningRuns) {
    cancelledRuns.push(await cancelScheduleRun(run.id, scheduleId, reason, {
      updateScheduleSummary: false,
    }));
  }

  const alreadyHandledWorkflowIds = new Set(
    cancelledRuns
      .map((result) => result.workflowId)
      .filter((workflowId): workflowId is string => Boolean(workflowId)),
  );
  const orphanWorkflowIds = findRunningWorkflowIdsForSchedule(scheduleId)
    .filter((workflowId) => !alreadyHandledWorkflowIds.has(workflowId));
  cancelledRuns.push(...await cancelWorkflowIds(orphanWorkflowIds, null));

  if (cancelledRuns.length > 0 && options?.updateScheduleSummary !== false) {
    recordScheduleRun(scheduleId, 'cancelled', reason);
    disableOneTimeScheduleAfterCancellation(scheduleId);
  }

  return { cancelledRuns };
}
