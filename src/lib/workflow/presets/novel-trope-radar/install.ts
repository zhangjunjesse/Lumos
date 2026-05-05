/**
 * 一键安装 / 重装网文套路雷达 schedule
 *
 * - 校验 RunParams (compliance-guard)
 * - 解析 cron → Lumos schedule 字段 (intervalMinutes/scheduleTime/scheduleDayOfWeek)
 * - 构造 V3 DSL
 * - 写入 scheduled_workflows
 *
 * 业务逻辑全在 lib,API 路由仅做透传 (参考 CLAUDE.md 规范)。
 */

import {
  createScheduledWorkflow,
  listScheduledWorkflows,
  updateScheduledWorkflow,
  type ScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { assertRunParamsValid } from './compliance-guard';
import { parseCronToSchedule } from './cron-utils';
import type { NovelTropeRadarRunParams } from './types';
import { buildWorkflowDsl } from './workflow.dsl';

export const PRESET_NAME = '网文套路雷达';
export const PRESET_KEY = 'novel-trope-radar';

export { parseCronToSchedule } from './cron-utils';

export interface InstallInput {
  runParams?: Partial<NovelTropeRadarRunParams>;
  /** 工作目录,默认空 (走 LUMOS_DATA_DIR) */
  workingDirectory?: string;
  browserContextId?: string;
}

export interface InstallResult {
  scheduleId: string;
  status: 'created' | 'updated';
  runParams: NovelTropeRadarRunParams;
}

function findExistingSchedule(): ScheduledWorkflow | null {
  return listScheduledWorkflows().find((s) => s.name === PRESET_NAME) ?? null;
}

/**
 * 开机引导用:仅在 schedule 不存在时创建,默认参数。
 * 已存在则只重建 DSL (适配代码升级),保留用户的 run_params/cron 等改动。
 */
export function ensureNovelTropeRadarSchedule(): InstallResult {
  const existing = findExistingSchedule();
  if (existing) {
    const existingParams =
      existing.runParams as unknown as Partial<NovelTropeRadarRunParams>;
    const runParams = assertRunParamsValid(existingParams ?? {});
    const dsl = buildWorkflowDsl(runParams, { agentPresetId: '' });
    updateScheduledWorkflow(existing.id, { workflowDsl: dsl });
    return { scheduleId: existing.id, status: 'updated', runParams };
  }
  return installNovelTropeRadar({});
}

/**
 * 安装或重装 schedule (用户显式调用)。已存在则更新 DSL/run_params。
 */
export function installNovelTropeRadar(input: InstallInput): InstallResult {
  const runParams = assertRunParamsValid(input.runParams ?? {});
  const dsl = buildWorkflowDsl(runParams, { agentPresetId: '' });
  const sched = parseCronToSchedule(runParams.cron);

  const existing = findExistingSchedule();
  if (existing) {
    updateScheduledWorkflow(existing.id, {
      workflowDsl: dsl,
      intervalMinutes: sched.intervalMinutes,
      scheduleTime: sched.scheduleTime,
      scheduleDayOfWeek: sched.scheduleDayOfWeek,
      runParams: runParams as unknown as Record<string, unknown>,
      ...(input.workingDirectory !== undefined
        ? { workingDirectory: input.workingDirectory }
        : {}),
      ...(input.browserContextId !== undefined
        ? { browserContextId: input.browserContextId }
        : {}),
    });
    return {
      scheduleId: existing.id,
      status: 'updated',
      runParams,
    };
  }

  const created = createScheduledWorkflow({
    name: PRESET_NAME,
    workflowDsl: dsl,
    runMode: 'scheduled',
    intervalMinutes: sched.intervalMinutes,
    scheduleTime: sched.scheduleTime,
    scheduleDayOfWeek: sched.scheduleDayOfWeek,
    workingDirectory: input.workingDirectory,
    browserContextId: input.browserContextId,
    notifyOnComplete: true,
    runParams: runParams as unknown as Record<string, unknown>,
  });

  return {
    scheduleId: created.id,
    status: 'created',
    runParams,
  };
}
