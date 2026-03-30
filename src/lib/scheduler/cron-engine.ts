/**
 * Interval-based scheduler engine.
 * Initialized lazily on first API call; runs in the Next.js server process.
 */
import {
  listDueSchedules,
  recordScheduleRun,
  type ScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { createSession } from '@/lib/db/sessions';
import { generateWorkflow } from '@/lib/workflow/compiler';
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
    runSchedule(schedule).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      recordScheduleRun(schedule.id, 'error', msg);
    });
  }
}

async function runSchedule(schedule: ScheduledWorkflow): Promise<void> {
  // Mark run started by recording a placeholder (next_run_at advances)
  // so concurrent ticks won't re-trigger the same schedule
  recordScheduleRun(schedule.id, 'success', '');

  try {
    const artifact = generateWorkflow({ spec: schedule.workflowDsl });

    if (!artifact.validation.valid) {
      const err = artifact.validation.errors.join('; ');
      recordScheduleRun(schedule.id, 'error', `DSL invalid: ${err}`);
      emitNotification(schedule, 'error', `工作流 DSL 无效: ${err}`);
      return;
    }

    const session = createSession(
      `[定时] ${schedule.name}`,
      undefined,
      undefined,
      schedule.workingDirectory || undefined,
      'workflow',
    );

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
      },
    });

    if (result.status === 'rejected') {
      const err = (result.errors || []).join('; ');
      recordScheduleRun(schedule.id, 'error', err);
      emitNotification(schedule, 'error', `工作流提交失败: ${err}`);
      return;
    }

    recordScheduleRun(schedule.id, 'success', '');

    if (schedule.notifyOnComplete) {
      emitNotification(schedule, 'success');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordScheduleRun(schedule.id, 'error', msg);
    emitNotification(schedule, 'error', msg);
    throw err;
  }
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
