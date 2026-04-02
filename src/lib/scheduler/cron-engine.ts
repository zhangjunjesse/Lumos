/**
 * Interval-based scheduler engine.
 * Initialized lazily on first API call; runs in the Next.js server process.
 */
import {
  listDueSchedules,
  getScheduledWorkflow,
  advanceScheduleTimer,
  recordScheduleRun,
  updateScheduledWorkflow,
  insertRunHistory,
  updateRunHistory,
  type ScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { createSession } from '@/lib/db/sessions';
import { generateWorkflowFromDsl } from '@/lib/workflow/compiler';
import { submitWorkflow } from '@/lib/workflow/api';
import { taskEventBus } from '@/lib/task-event-bus';

const TICK_INTERVAL_MS = 60_000; // 1 minute
let tickTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

export function initScheduler(): void {
  if (initialized) return;
  initialized = true;

  // Run first tick after 10s to allow server to fully start
  setTimeout(() => {
    runTick().catch(console.error);
    tickTimer = setInterval(() => {
      runTick().catch(console.error);
    }, TICK_INTERVAL_MS);
  }, 10_000);
}

export function stopScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  initialized = false;
}

async function runTick(): Promise<void> {
  const due = listDueSchedules();
  for (const schedule of due) {
    // Advance timer immediately so concurrent ticks won't re-trigger
    advanceScheduleTimer(schedule.id);
    runSchedule(schedule, false).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      recordScheduleRun(schedule.id, 'error', msg);
    });
  }
}

async function runSchedule(
  schedule: ScheduledWorkflow,
  isManual: boolean,
  runParams?: Record<string, unknown>,
): Promise<void> {
  const artifact = generateWorkflowFromDsl(schedule.workflowDsl);
  if (!artifact.validation.valid) {
    const err = artifact.validation.errors.join('; ');
    recordScheduleRun(schedule.id, 'error', `DSL invalid: ${err}`);
    emitNotification(schedule, 'error', `工作流 DSL 无效: ${err}`);
    return;
  }

  const modeLabel = isManual ? '手动' : schedule.runMode === 'once' ? '一次性' : '定时';
  const label = `[${modeLabel}] ${schedule.name}`;
  const session = createSession(label, undefined, undefined, schedule.workingDirectory || undefined, 'workflow');
  const runId = insertRunHistory(schedule.id, session.id);
  const effectiveParams = runParams ?? schedule.runParams ?? {};

  try {
    const result = await submitWorkflow({
      taskId: session.id,
      workflowCode: artifact.code,
      workflowManifest: artifact.manifest,
      inputs: {
        __lumosRuntime: {
          taskId: session.id,
          sessionId: session.id,
          workingDirectory: schedule.workingDirectory || undefined,
        },
        ...effectiveParams,
      },
    }, {
      onCompleted: () => {
        recordScheduleRun(schedule.id, 'success', '');
        updateRunHistory(runId, 'success');
        // Disable one-time tasks after execution
        if (schedule.runMode === 'once') {
          updateScheduledWorkflow(schedule.id, { enabled: false });
        }
        if (schedule.notifyOnComplete) emitNotification(schedule, 'success');
      },
      onFailed: (event) => {
        const msg = event.error.message || '工作流执行失败';
        recordScheduleRun(schedule.id, 'error', msg);
        updateRunHistory(runId, 'error', msg);
        if (schedule.runMode === 'once') {
          updateScheduledWorkflow(schedule.id, { enabled: false });
        }
        emitNotification(schedule, 'error', msg);
      },
    });

    if (result.status === 'rejected') {
      const err = (result.errors || []).join('; ');
      recordScheduleRun(schedule.id, 'error', err);
      updateRunHistory(runId, 'error', err);
      emitNotification(schedule, 'error', `工作流提交失败: ${err}`);
    }
    // 注意：不再在这里标记 success —— 交给 onCompleted 回调
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordScheduleRun(schedule.id, 'error', msg);
    updateRunHistory(runId, 'error', msg);
    emitNotification(schedule, 'error', msg);
  }
}

export async function triggerSchedule(scheduleId: string, runParams?: Record<string, unknown>): Promise<void> {
  const schedule = getScheduledWorkflow(scheduleId);
  if (!schedule) throw new Error('任务不存在');
  await runSchedule(schedule, true, runParams);
}

function emitNotification(
  schedule: ScheduledWorkflow,
  status: 'success' | 'error',
  detail?: string,
): void {
  try {
    taskEventBus.emitGlobalEvent({
      type: 'schedule:run',
      data: {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        status,
        ...(detail ? { detail } : {}),
        runAt: new Date().toISOString(),
      },
    });
  } catch {
    // Non-fatal
  }
}
