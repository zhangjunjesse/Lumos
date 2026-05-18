/**
 * 自动化的持久化与调度态投影（store 层）。
 *
 * 仅负责 setting 读写、行校验、以及把后台 scheduled_workflows 的运行态合并
 * 进 Automation（lastRun/nextRun/状态）。从 automations.ts 拆出（CLAUDE.md
 * 单文件 ≤300 行；store 与 lifecycle 编排关注点分离）。
 */
import { getSetting, setSetting } from '@/lib/db';
import {
  getScheduledWorkflow,
  listRunHistory,
  type ScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';

import type { Automation } from '@/components/apps/builtin/wechat/relations-types';

import { parseIsoMs } from './automation-schedule';

const SETTINGS_KEY = 'apps.wechat-assistant.automations.v1';

export function readAutomations(): Automation[] {
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

export function writeAutomations(automations: Automation[]): void {
  setSetting(SETTINGS_KEY, JSON.stringify(automations));
}

export function hydrateAutomationScheduleState(automation: Automation): Automation {
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
