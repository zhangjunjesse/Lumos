import { randomUUID } from 'node:crypto';

import { getSetting, setSetting } from '@/lib/db';
import {
  createScheduledWorkflow,
  deleteScheduledWorkflow,
  getScheduledWorkflow,
  listRunHistory,
  updateScheduledWorkflow,
  type ScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { triggerSchedule } from '@/lib/scheduler/cron-engine';
import {
  assertScheduleCancellationResolved,
  cancelRunningScheduleRuns,
} from '@/lib/workflow/schedule-run-control';

import type { Automation } from '@/components/apps/builtin/wechat/relations-types';
import type { WorkflowDSLV3 } from '@/lib/workflow/types-v3';
import { listWeChatAssistantTasks } from './tasks';

const SETTINGS_KEY = 'apps.wechat-assistant.automations.v1';
const DSL_MIGRATION_KEY = 'apps.wechat-assistant.automations.dsl-main-agent-migrated';

export type AutomationDraft = Omit<Automation, 'id' | 'createdAt'>;

export function listWeChatAutomations(): Automation[] {
  return readAutomations()
    .map(hydrateAutomationScheduleState)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function ensureLegacyDailySummaryAutomation(): Promise<void> {
  await migrateAutomationDslsToMainAgent();
  const current = readAutomations();
  if (current.some(isWeChatSummaryAutomation)) return;

  const dailyTask = listWeChatAssistantTasks().find((task) => task.id === 'daily-summary');
  if (!dailyTask?.enabled) return;

  const schedule = dailySummaryScheduleFromLegacyTask(dailyTask.schedule);
  await createWeChatAutomation({
    name: '每日微信总结',
    kind: 'reminder_recurring',
    cron: schedule.cron,
    cronLabel: schedule.cronLabel,
    action: {
      kind: 'wechat_summary',
      messageTemplate: '汇总今天微信消息，提炼重点、待办和需要跟进的人。',
    },
    enabled: true,
  });
}

export async function createWeChatAutomation(draft: AutomationDraft): Promise<Automation> {
  const base: Automation = {
    ...draft,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  const automation = await syncSchedule(base);
  writeAutomations([automation, ...readAutomations()]);
  return automation;
}

export async function updateWeChatAutomation(
  id: string,
  patch: Partial<AutomationDraft>,
): Promise<Automation | null> {
  let updated: Automation | null = null;
  const current = readAutomations();
  for (const automation of current) {
    if (automation.id === id) {
      updated = await syncSchedule({ ...automation, ...patch });
      break;
    }
  }
  if (!updated) return null;
  const next = current.map((automation) => {
    if (automation.id !== id) return automation;
    return updated;
  });
  writeAutomations(next);
  return updated;
}

export async function deleteWeChatAutomation(id: string): Promise<boolean> {
  const current = readAutomations();
  const target = current.find((automation) => automation.id === id) ?? null;
  const next = current.filter((automation) => automation.id !== id);
  if (next.length === current.length) return false;
  if (target?.scheduleId) {
    const cancelResult = await cancelRunningScheduleRuns(target.scheduleId, '微信助手自动化已删除，停止执行中的工作流', {
      updateScheduleSummary: false,
    });
    assertScheduleCancellationResolved(cancelResult, '删除微信自动化');
    deleteScheduledWorkflow(target.scheduleId);
  }
  writeAutomations(next);
  return true;
}

export async function triggerWeChatAutomation(id: string): Promise<Automation | null> {
  const automation = readAutomations().find((item) => item.id === id) ?? null;
  if (!automation) return null;
  const hydrated = hydrateAutomationScheduleState(automation);
  if (!hydrated.scheduleId || hydrated.scheduleError) {
    throw new Error(hydrated.scheduleError || '这条自动化还没有接入调度，暂不能运行');
  }
  await triggerSchedule(hydrated.scheduleId, {
    automationId: hydrated.id,
    source: 'wechat-assistant',
    manual: true,
  });
  return hydrateAutomationScheduleState(hydrated);
}

function readAutomations(): Automation[] {
  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAutomation);
  } catch {
    return [];
  }
}

function writeAutomations(automations: Automation[]): void {
  setSetting(SETTINGS_KEY, JSON.stringify(automations));
}

function hydrateAutomationScheduleState(automation: Automation): Automation {
  if (!automation.scheduleId) return automation;
  const schedule = getScheduledWorkflow(automation.scheduleId);
  if (!schedule) {
    return {
      ...automation,
      scheduleError: '关联的调度任务不存在，请重新保存这条规则',
      lastRunAt: undefined,
      nextRunAt: undefined,
    };
  }
  return mergeScheduleState(automation, schedule);
}

function mergeScheduleState(automation: Automation, schedule: ScheduledWorkflow): Automation {
  const latestRun = listRunHistory(schedule.id, 1)[0];
  const next: Automation = {
    ...automation,
    enabled: schedule.enabled,
    lastRunError: latestRun?.error || schedule.lastError || undefined,
    latestRunId: latestRun?.id,
  };
  if (typeof schedule.runCount === 'number') next.scheduleRunCount = schedule.runCount;
  const lastRunStatus = latestRun?.status ?? schedule.lastRunStatus;
  if (lastRunStatus) next.lastRunStatus = lastRunStatus;
  const lastRunAt = parseIsoMs(schedule.lastRunAt);
  const nextRunAt = parseIsoMs(schedule.nextRunAt);
  if (lastRunAt !== undefined) next.lastRunAt = lastRunAt;
  else delete next.lastRunAt;
  if (nextRunAt !== undefined) next.nextRunAt = nextRunAt;
  else delete next.nextRunAt;
  const scheduleError = automation.scheduleError;
  if (scheduleError) next.scheduleError = scheduleError;
  else delete next.scheduleError;
  if (!next.lastRunError) delete next.lastRunError;
  if (!next.latestRunId) delete next.latestRunId;
  return next;
}

function isAutomation(value: unknown): value is Automation {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && typeof row.name === 'string'
    && (row.kind === 'reminder_once' || row.kind === 'reminder_recurring')
    && typeof row.cron === 'string'
    && typeof row.cronLabel === 'string'
    && typeof row.action === 'object'
    && typeof row.enabled === 'boolean'
    && typeof row.createdAt === 'number';
}

interface ParsedSchedule {
  runMode: 'scheduled' | 'once';
  intervalMinutes: number;
  scheduleTime: string | null;
  scheduleDayOfWeek: number | null;
  nextRunAt?: string;
}

async function syncSchedule(input: Automation): Promise<Automation> {
  const parsed = parseAutomationSchedule(input);
  if (!parsed) {
    if (input.scheduleId) {
      await cancelRunningScheduleRuns(input.scheduleId, '微信助手自动化规则暂不可执行，停止执行中的工作流');
      updateScheduledWorkflow(input.scheduleId, { enabled: false });
    }
    return {
      ...input,
      scheduleError: '当前时间规则暂不能自动执行，已保存为手动规则',
    };
  }

  const workflowDsl = buildAutomationWorkflowDsl(input);
  const name = `微信助手 · ${input.name}`;
  const existing = input.scheduleId ? getScheduledWorkflow(input.scheduleId) : null;
  const schedule = existing
    ? updateScheduledWorkflow(input.scheduleId!, {
        name,
        workflowDsl,
        runMode: parsed.runMode,
        intervalMinutes: parsed.intervalMinutes,
        scheduleTime: parsed.scheduleTime,
        scheduleDayOfWeek: parsed.scheduleDayOfWeek,
        nextRunAt: parsed.nextRunAt,
        enabled: input.enabled,
        notifyOnComplete: true,
        runParams: { automationId: input.id, source: 'wechat-assistant' },
      })
    : createScheduledWorkflow({
        name,
        workflowDsl,
        runMode: parsed.runMode,
        intervalMinutes: parsed.intervalMinutes,
        scheduleTime: parsed.scheduleTime,
        scheduleDayOfWeek: parsed.scheduleDayOfWeek,
        notifyOnComplete: true,
        browserContextId: 'embedded:default',
        runParams: { automationId: input.id, source: 'wechat-assistant' },
        nextRunAt: parsed.nextRunAt,
      });

  if (!schedule) {
    return {
      ...input,
      scheduleError: '自动化任务同步失败',
    };
  }
  if (!input.enabled) {
    await cancelRunningScheduleRuns(schedule.id, '微信助手自动化已关闭，停止执行中的工作流', {
      updateScheduleSummary: false,
    });
    updateScheduledWorkflow(schedule.id, { enabled: false });
  }

  return {
    ...input,
    scheduleId: schedule.id,
    scheduleError: undefined,
  };
}

export function parseAutomationSchedule(input: Pick<Automation, 'kind' | 'cron' | 'nextRunAt'>): ParsedSchedule | null {
  if (input.kind === 'reminder_once') {
    if (!input.nextRunAt || input.nextRunAt <= Date.now()) return null;
    return {
      runMode: 'once',
      intervalMinutes: 0,
      scheduleTime: null,
      scheduleDayOfWeek: null,
      nextRunAt: new Date(input.nextRunAt).toISOString(),
    };
  }

  const parts = input.cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isInt(minute) && isInt(hour)) {
    return {
      runMode: 'scheduled',
      intervalMinutes: 1440,
      scheduleTime: `${padHour(Number(hour))}:${padMinute(Number(minute))}`,
      scheduleDayOfWeek: null,
    };
  }

  if (dayOfMonth === '*' && month === '*' && isInt(minute) && isInt(hour) && isWeekday(dayOfWeek)) {
    return {
      runMode: 'scheduled',
      intervalMinutes: 10080,
      scheduleTime: `${padHour(Number(hour))}:${padMinute(Number(minute))}`,
      scheduleDayOfWeek: Number(dayOfWeek),
    };
  }

  const minuteStep = /^\*\/(\d+)$/.exec(minute);
  if (minuteStep && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = Number(minuteStep[1]);
    return interval > 0 ? {
      runMode: 'scheduled',
      intervalMinutes: interval,
      scheduleTime: null,
      scheduleDayOfWeek: null,
    } : null;
  }

  const hourStep = /^\*\/(\d+)$/.exec(hour);
  if (isInt(minute) && hourStep && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = Number(hourStep[1]) * 60;
    return interval > 0 ? {
      runMode: 'scheduled',
      intervalMinutes: interval,
      scheduleTime: null,
      scheduleDayOfWeek: null,
    } : null;
  }

  return null;
}

export function buildAutomationWorkflowDsl(automation: Automation): WorkflowDSLV3 {
  if (isWeChatSummaryAutomation(automation)) {
    return buildSummaryWorkflowDsl(automation);
  }

  return {
    version: 'v3',
    name: `微信助手自动化 · ${automation.name}`,
    description: '由微信助手自动化规则创建的提醒工作流。',
    nodes: [{
      id: 'notify',
      type: 'notification',
      input: {
        channel: 'im:wechat',
        level: 'info',
        targetSessionRef: 'main-agent',
        message: buildNotificationMessage(automation),
      },
      policy: { timeoutMs: 30_000 },
    }],
    edges: [],
    maxDurationMs: 60_000,
  };
}

function buildSummaryWorkflowDsl(automation: Automation): WorkflowDSLV3 {
  return {
    version: 'v3',
    name: `微信助手自动化 · ${automation.name}`,
    description: '由微信助手自动化规则创建的微信消息总结工作流。',
    nodes: [
      {
        id: 'generate_report',
        type: 'agent',
        input: {
          prompt: '读取本机微信同步镜像，生成微信消息总结报告。',
          outputMode: 'plain-text',
          code: {
            handler: 'wechat-assistant.daily-summary',
            strategy: 'code-only',
            params: {
              automationId: automation.id,
              automationName: automation.name,
              messageTemplate: automation.action.messageTemplate,
            },
          },
        },
        outputContract: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            notification: { type: 'string' },
            reportPath: { type: 'string' },
            reportMarkdown: { type: 'string' },
          },
        },
        policy: { timeoutMs: 180_000 },
      },
      {
        id: 'notify',
        type: 'notification',
        input: {
          channel: 'im:wechat',
          level: 'info',
          targetSessionRef: 'main-agent',
          message: '{{ steps.generate_report.output.notification }}',
        },
        policy: { timeoutMs: 30_000 },
      },
    ],
    edges: [{ from: 'generate_report', to: 'notify', kind: 'next' }],
    maxDurationMs: 240_000,
  };
}

function isWeChatSummaryAutomation(automation: Automation): boolean {
  if (automation.action.kind === 'wechat_summary') return true;
  if (automation.action.kind !== 'custom') return false;
  return /微信.{0,6}(总结|摘要|日报|汇总)|总结.{0,6}微信|汇总.{0,6}微信/.test(
    `${automation.name}\n${automation.action.messageTemplate}`,
  );
}

function buildNotificationMessage(automation: Automation): string {
  const template = automation.action.messageTemplate.trim();
  return [
    `微信助手提醒：${automation.name}`,
    template,
    automation.followupId ? `关联跟进：${automation.followupId}` : '',
  ].filter(Boolean).join('\n\n');
}

function dailySummaryScheduleFromLegacyTask(value: string): { cron: string; cronLabel: string } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match) {
    const hour = padHour(Number(match[1]));
    const minute = padMinute(Number(match[2]));
    return {
      cron: `${Number(minute)} ${Number(hour)} * * *`,
      cronLabel: `每天 ${hour}:${minute}`,
    };
  }
  return {
    cron: '0 21 * * *',
    cronLabel: '每天 21:00',
  };
}

function parseIsoMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

function isInt(value: string): boolean {
  return /^\d{1,2}$/.test(value);
}

function isWeekday(value: string): boolean {
  return /^[0-6]$/.test(value);
}

function padHour(value: number): string {
  return String(Math.min(23, Math.max(0, value))).padStart(2, '0');
}

function padMinute(value: number): string {
  return String(Math.min(59, Math.max(0, value))).padStart(2, '0');
}

/**
 * One-shot migration: rebuilds the workflow DSL of every existing WeChat
 * automation so the `notify` step routes to the Main Agent session + IM
 * binding instead of the workflow's own transient session id.
 *
 * Idempotent — guarded by a settings flag so repeat boots are cheap.
 */
export async function migrateAutomationDslsToMainAgent(): Promise<void> {
  if (getSetting(DSL_MIGRATION_KEY) === '1') return;
  const current = readAutomations();
  if (!current.length) {
    setSetting(DSL_MIGRATION_KEY, '1');
    return;
  }
  const migrated: Automation[] = [];
  for (const automation of current) {
    try {
      migrated.push(await syncSchedule(automation));
    } catch (error) {
      console.warn('[wechat-assistant] DSL migration failed for automation', automation.id, error);
      migrated.push(automation);
    }
  }
  writeAutomations(migrated);
  setSetting(DSL_MIGRATION_KEY, '1');
}
