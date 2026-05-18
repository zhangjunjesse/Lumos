import { randomUUID } from 'node:crypto';

import { getSetting, setSetting } from '@/lib/db';
import {
  createScheduledWorkflow,
  deleteScheduledWorkflow,
  getScheduledWorkflow,
  updateScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { triggerSchedule } from '@/lib/scheduler/cron-engine';
import {
  assertScheduleCancellationResolved,
  cancelRunningScheduleRuns,
} from '@/lib/workflow/schedule-run-control';

import type { Automation } from '@/components/apps/builtin/wechat/relations-types';
import {
  deriveSummarySpec,
  isWeChatSummaryAutomation,
  withSummarySpec,
} from './automation-summary-spec';
import { buildAutomationWorkflowDsl } from './automation-dsl';
import {
  dailySummaryScheduleFromLegacyTask,
  parseAutomationSchedule,
} from './automation-schedule';
import {
  hydrateAutomationScheduleState,
  readAutomations,
  writeAutomations,
} from './automation-store';
import { listWeChatAssistantTasks } from './tasks';

// 拆分后保持公共入口稳定：intent-spec / dsl-build / schedule-parse 已分层，
// 仍从 automations re-export 被测试/外部直接引用符号（门面，零行为变化）。
export { deriveSummarySpec, buildAutomationWorkflowDsl, parseAutomationSchedule };

/**
 * DSL/Spec schema 版本。单调递增——任何会改变 buildAutomationWorkflowDsl 或
 * deriveSummarySpec 输出的逻辑变更都 +1。存量行在启动时由
 * ensureAutomationDslSchema 一次性重建（重跑 syncSchedule，顺带回填
 * summarySpec）。取代过去"每个路由 bug 加一个一次性迁移键"的累积反模式。
 */
const DSL_SCHEMA_VERSION = 3;
const DSL_SCHEMA_VERSION_KEY = 'apps.wechat-assistant.automations.dsl-schema-version';

export type AutomationDraft = Omit<Automation, 'id' | 'createdAt'>;

export function listWeChatAutomations(): Automation[] {
  return readAutomations()
    .map(hydrateAutomationScheduleState)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function ensureLegacyDailySummaryAutomation(): Promise<void> {
  await ensureAutomationDslSchema();
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

async function syncSchedule(rawInput: Automation): Promise<Automation> {
  // 唯一归一收口点：create / update / schema 迁移都经此。意图在这里被解析
  // 一次成结构化 summarySpec，下游（DSL 构建 / handler）只读 spec，不再各
  // 层启发式反推。
  const input = withSummarySpec(rawInput);
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

/**
 * 单一版本号迁移，取代过去"每个路由 bug 一个一次性 key"的累积反模式
 * （曾有 dsl-main-agent-migrated + summary-classify-fix-migrated 两个键）。
 *
 * workflowDsl 是 (automation, 代码) 的纯函数却被持久化进 scheduled_workflows、
 * scheduler 只跑存量行不重导——所以任何会改变 DSL/Spec 输出的逻辑变更都需
 * 重建存量。这里用单调 DSL_SCHEMA_VERSION 对比已存版本：落后即对所有
 * automation 重跑 syncSchedule（顺带经 withSummarySpec 回填 summarySpec），
 * 然后写入当前版本。幂等；重启廉价。以后逻辑再变只需 +1 版本号，不再加键。
 */
export async function ensureAutomationDslSchema(): Promise<void> {
  const stored = Number(getSetting(DSL_SCHEMA_VERSION_KEY) ?? 0);
  if (stored >= DSL_SCHEMA_VERSION) return;
  const current = readAutomations();
  if (!current.length) {
    setSetting(DSL_SCHEMA_VERSION_KEY, String(DSL_SCHEMA_VERSION));
    return;
  }
  const rebuilt: Automation[] = [];
  for (const automation of current) {
    try {
      rebuilt.push(await syncSchedule(automation));
    } catch (error) {
      console.warn(
        '[wechat-assistant] DSL schema migration failed for automation',
        automation.id,
        error,
      );
      rebuilt.push(automation);
    }
  }
  writeAutomations(rebuilt);
  setSetting(DSL_SCHEMA_VERSION_KEY, String(DSL_SCHEMA_VERSION));
}
