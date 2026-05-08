import {
  createScheduledWorkflow,
  getScheduledWorkflow,
  updateScheduledWorkflow,
  type CreateScheduledWorkflowInput,
  type ScheduledWorkflow,
  type UpdateScheduledWorkflowInput,
} from '@/lib/db/scheduled-workflows';
import type { WorkflowDSLV3 } from '@/lib/workflow/types';

import type { AppManifest } from './manifest/types';
import {
  resolveNativeAppAutomationAction,
  SUPPORTED_NATIVE_AUTOMATION_ACTIONS,
} from './native-automation-runner';
import type { AppDataStore } from './runtime/data-store';

export interface NativeAppAutomationScheduleResult {
  ok: boolean;
  automationId: string;
  message: string;
  scheduleId?: string;
  nextRunAt?: string | null;
  error?: string;
}

export interface NativeAppAutomationSchedulerDeps {
  now?: () => number;
  getSchedule?: (id: string) => ScheduledWorkflow | null;
  createSchedule?: (input: CreateScheduledWorkflowInput) => ScheduledWorkflow;
  updateSchedule?: (id: string, input: UpdateScheduledWorkflowInput) => ScheduledWorkflow | null;
  cancelRunningScheduleRuns?: (
    scheduleId: string,
    reason: string,
    options?: { updateScheduleSummary?: boolean },
  ) => Promise<CancelRunningScheduleRunsResult>;
}

interface CancelScheduleRunResult {
  resolved: boolean;
  message: string;
}

interface CancelRunningScheduleRunsResult {
  cancelledRuns: CancelScheduleRunResult[];
  unresolvedRuns: CancelScheduleRunResult[];
  allResolved: boolean;
}

interface AppAutomationRow extends Record<string, unknown> {
  title?: string;
  enabled?: boolean;
  schedule?: string;
  description?: string;
  native_action?: string;
  last_status?: 'not_connected' | 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  last_run_summary?: string;
  last_run_id?: string;
  schedule_id?: string;
  schedule_status?: 'not_connected' | 'scheduled' | 'paused' | 'failed';
  schedule_error?: string;
  next_run_at?: string | null;
  updated_at?: string;
}

interface ParsedAutomationSchedule {
  label: string;
  intervalMinutes: number;
  scheduleTime: string | null;
  scheduleDayOfWeek: number | null;
}

export async function syncNativeAppAutomationSchedule(input: {
  appId: string;
  manifest: AppManifest;
  store: AppDataStore;
  rowId: string;
  deps?: NativeAppAutomationSchedulerDeps;
}): Promise<NativeAppAutomationScheduleResult> {
  const deps = {
    now: input.deps?.now ?? (() => Date.now()),
    getSchedule: input.deps?.getSchedule ?? getScheduledWorkflow,
    createSchedule: input.deps?.createSchedule ?? createScheduledWorkflow,
    updateSchedule: input.deps?.updateSchedule ?? updateScheduledWorkflow,
    cancelRunningScheduleRuns: input.deps?.cancelRunningScheduleRuns ?? defaultCancelRunningScheduleRuns,
  };
  const now = deps.now();
  const updatedAt = new Date(now).toISOString();
  const automation = input.store.get<AppAutomationRow>('app_automations', input.rowId);

  const finish = (
    ok: boolean,
    message: string,
    patch: Partial<AppAutomationRow> = {},
  ): NativeAppAutomationScheduleResult => {
    input.store.create('run_history', {
      title: automation?.title ? `同步定时任务：${automation.title}` : '同步应用自动化定时任务',
      status: ok ? 'success' : 'failed',
      summary: message,
      failure_reason: ok ? '' : message,
      updated_at: updatedAt,
    });
    if (automation) {
      input.store.update<AppAutomationRow>('app_automations', automation.id, {
        ...patch,
        updated_at: updatedAt,
      });
    }
    return {
      ok,
      automationId: input.rowId,
      message,
      scheduleId: typeof patch.schedule_id === 'string' ? patch.schedule_id : automation?.schedule_id,
      nextRunAt: patch.next_run_at !== undefined ? patch.next_run_at : automation?.next_run_at,
      error: ok ? undefined : message,
    };
  };

  if (!automation) {
    return finish(false, '找不到要同步的应用自动化。');
  }

  if (!input.manifest.permissions?.system?.includes('schedule')) {
    return finish(false, '当前应用没有 system.schedule 权限，不能注册定时任务。', {
      schedule_status: 'failed',
      schedule_error: '缺少 system.schedule 权限。',
    });
  }

  if (automation.enabled !== true) {
    if (automation.schedule_id) {
      const cancelResult = await deps.cancelRunningScheduleRuns(
        automation.schedule_id,
        '应用自动化已关闭，停止执行中的定时任务',
        { updateScheduleSummary: false },
      );
      assertCancellationResolved(cancelResult, '关闭应用自动化定时任务');
      deps.updateSchedule(automation.schedule_id, { enabled: false, nextRunAt: null });
    }
    return finish(true, '自动化未启用；已暂停关联的定时任务。', {
      schedule_status: 'paused',
      schedule_error: '',
      next_run_at: null,
      last_status: 'idle',
      last_run_summary: '自动化未启用；定时任务已暂停。',
    });
  }

  const nativeAction = resolveNativeAppAutomationAction(input.manifest, automation);
  if (!nativeAction) {
    return finish(false, '这条自动化没有绑定可执行动作；请先填写执行动作，例如 goofish:sync。', {
      schedule_status: 'failed',
      schedule_error: '缺少可执行动作。',
    });
  }
  if (!SUPPORTED_NATIVE_AUTOMATION_ACTIONS.has(nativeAction)) {
    return finish(false, `当前定时任务桥尚未接入动作：${nativeAction}`, {
      schedule_status: 'failed',
      schedule_error: `未接入动作：${nativeAction}`,
    });
  }

  const parsed = parseNativeAutomationSchedule(automation.schedule);
  if (!parsed) {
    return finish(false, '触发规则还不是可自动执行的定时规则；请填写例如“每天 09:00”或“每 2 小时”。', {
      schedule_status: 'not_connected',
      schedule_error: '触发规则暂不能自动执行。',
    });
  }

  const workflowDsl = buildNativeAutomationWorkflowDsl({
    appId: input.appId,
    appName: input.manifest.name,
    automationId: automation.id,
    automationTitle: automation.title || '应用自动化',
    nativeAction,
  });
  const scheduleInput = {
    name: `应用自动化 · ${input.manifest.name} · ${automation.title || automation.id}`,
    workflowDsl,
    runMode: 'scheduled' as const,
    intervalMinutes: parsed.intervalMinutes,
    scheduleTime: parsed.scheduleTime,
    scheduleDayOfWeek: parsed.scheduleDayOfWeek,
    notifyOnComplete: true,
    browserContextId: 'embedded:default',
    runParams: {
      appId: input.appId,
      automationId: automation.id,
      source: 'native-app-automation',
      nativeAction,
    },
  };

  const existing = automation.schedule_id ? deps.getSchedule(automation.schedule_id) : null;
  const schedule = existing
    ? deps.updateSchedule(automation.schedule_id!, { ...scheduleInput, enabled: true })
    : deps.createSchedule(scheduleInput);

  if (!schedule) {
    return finish(false, '定时任务同步失败。', {
      schedule_status: 'failed',
      schedule_error: '定时任务同步失败。',
    });
  }

  const message = `已同步定时任务：${parsed.label}。下一次运行：${schedule.nextRunAt || '待计算'}。`;
  return finish(true, message, {
    schedule_id: schedule.id,
    schedule_status: 'scheduled',
    schedule_error: '',
    next_run_at: schedule.nextRunAt,
    last_status: 'idle',
    last_run_summary: message,
  });
}

export function parseNativeAutomationSchedule(value: unknown): ParsedAutomationSchedule | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /^(手动触发|手动|未设置|manual)$/i.test(text)) return null;

  const cron = parseCronSchedule(text);
  if (cron) return cron;

  const daily = /(?:每天|每日)\s*(\d{1,2})\s*[:：点]\s*(\d{1,2})?/.exec(text);
  if (daily) {
    const hour = clamp(Number(daily[1]), 0, 23);
    const minute = clamp(Number(daily[2] ?? 0), 0, 59);
    return {
      label: `每天 ${padHour(hour)}:${padMinute(minute)}`,
      intervalMinutes: 1440,
      scheduleTime: `${padHour(hour)}:${padMinute(minute)}`,
      scheduleDayOfWeek: null,
    };
  }

  const hourStep = /每\s*(\d{1,2})\s*(?:个)?小时/.exec(text);
  if (hourStep) {
    const hours = clamp(Number(hourStep[1]), 1, 24);
    return {
      label: `每 ${hours} 小时`,
      intervalMinutes: hours * 60,
      scheduleTime: null,
      scheduleDayOfWeek: null,
    };
  }

  const minuteStep = /每\s*(\d{1,3})\s*分钟/.exec(text);
  if (minuteStep) {
    const minutes = clamp(Number(minuteStep[1]), 5, 1440);
    return {
      label: `每 ${minutes} 分钟`,
      intervalMinutes: minutes,
      scheduleTime: null,
      scheduleDayOfWeek: null,
    };
  }

  return null;
}

export function buildNativeAutomationWorkflowDsl(input: {
  appId: string;
  appName: string;
  automationId: string;
  automationTitle: string;
  nativeAction: string;
}): WorkflowDSLV3 {
  return {
    version: 'v3',
    name: `应用自动化 · ${input.appName} · ${input.automationTitle}`,
    description: '由用户生成应用的自动化规则创建，运行受控原生应用动作。',
    nodes: [{
      id: 'run_automation',
      type: 'agent',
      input: {
        prompt: `运行应用「${input.appName}」的自动化「${input.automationTitle}」。`,
        outputMode: 'structured',
        code: {
          handler: 'native-app.run-automation',
          strategy: 'code-only',
          params: {
            appId: input.appId,
            automationId: input.automationId,
            nativeAction: input.nativeAction,
          },
        },
      },
      outputContract: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          appId: { type: 'string' },
          automationId: { type: 'string' },
          runId: { type: 'string' },
          nativeAction: { type: 'string' },
        },
      },
      policy: { timeoutMs: 180_000 },
    }],
    edges: [],
    maxDurationMs: 240_000,
  };
}

function parseCronSchedule(text: string): ParsedAutomationSchedule | null {
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isInt(minute) && isInt(hour)) {
    return {
      label: `每天 ${padHour(Number(hour))}:${padMinute(Number(minute))}`,
      intervalMinutes: 1440,
      scheduleTime: `${padHour(Number(hour))}:${padMinute(Number(minute))}`,
      scheduleDayOfWeek: null,
    };
  }
  if (dayOfMonth === '*' && month === '*' && isInt(minute) && isInt(hour) && /^[0-6]$/.test(dayOfWeek)) {
    return {
      label: `每周 ${dayOfWeek} ${padHour(Number(hour))}:${padMinute(Number(minute))}`,
      intervalMinutes: 10080,
      scheduleTime: `${padHour(Number(hour))}:${padMinute(Number(minute))}`,
      scheduleDayOfWeek: Number(dayOfWeek),
    };
  }
  const minuteStep = /^\*\/(\d+)$/.exec(minute);
  if (minuteStep && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = Number(minuteStep[1]);
    if (interval > 0) {
      return {
        label: `每 ${interval} 分钟`,
        intervalMinutes: interval,
        scheduleTime: null,
        scheduleDayOfWeek: null,
      };
    }
  }
  return null;
}

function isInt(value: string): boolean {
  return /^\d{1,2}$/.test(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function padHour(value: number): string {
  return String(clamp(value, 0, 23)).padStart(2, '0');
}

function padMinute(value: number): string {
  return String(clamp(value, 0, 59)).padStart(2, '0');
}

async function defaultCancelRunningScheduleRuns(
  scheduleId: string,
  reason: string,
  options?: { updateScheduleSummary?: boolean },
): Promise<CancelRunningScheduleRunsResult> {
  const mod = await import('@/lib/workflow/schedule-run-control');
  return mod.cancelRunningScheduleRuns(scheduleId, reason, options);
}

function assertCancellationResolved(
  result: CancelRunningScheduleRunsResult,
  actionLabel: string,
): void {
  const unresolvedRuns = Array.isArray(result.unresolvedRuns)
    ? result.unresolvedRuns
    : result.cancelledRuns.filter((item) => !item.resolved);
  if (result.allResolved || unresolvedRuns.length === 0) return;
  const messages = Array.from(new Set(
    unresolvedRuns
      .map((item) => item.message.trim())
      .filter(Boolean),
  )).slice(0, 2);
  throw new Error([
    `${actionLabel}前还有 ${unresolvedRuns.length} 个运行中的执行未确认停止`,
    messages.length > 0 ? `原因：${messages.join('；')}` : '',
    '请稍后重试，避免页面已删除但底层仍在运行。',
  ].filter(Boolean).join('。'));
}
