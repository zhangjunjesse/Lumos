import {
  createWeChatAutomation,
  deleteWeChatAutomation,
  buildAutomationWorkflowDsl,
  deriveSummarySpec,
  ensureAutomationDslSchema,
  ensureLegacyDailySummaryAutomation,
  listWeChatAutomations,
  parseAutomationSchedule,
  triggerWeChatAutomation,
  updateWeChatAutomation,
} from '../automations';
import type { GroupTag } from '@/components/apps/builtin/wechat/app-settings';
import { generateWorkflowFromDsl } from '@/lib/workflow/compiler';

const store = new Map<string, string>();
const schedules = new Map<string, Record<string, unknown>>();
const resolvedCancelResult = {
  cancelledRuns: [],
  unresolvedRuns: [],
  allResolved: true,
};
const unresolvedCancelRun = {
  runId: 'run-1',
  workflowId: 'workflow-1',
  cancelled: false,
  resolved: false,
  message: '底层执行仍在运行，取消请求未生效',
};
const mockCancelRunningScheduleRuns = jest.fn(async () => resolvedCancelResult);

jest.mock('@/lib/db', () => ({
  getSetting: jest.fn((key: string) => store.get(key) ?? null),
  setSetting: jest.fn((key: string, value: string) => {
    store.set(key, value);
  }),
}));

jest.mock('@/lib/db/scheduled-workflows', () => ({
  createScheduledWorkflow: jest.fn((input: Record<string, unknown>) => {
    const id = `schedule-${schedules.size + 1}`;
    const schedule = { ...input, id, enabled: true };
    schedules.set(id, schedule);
    return schedule;
  }),
  getScheduledWorkflow: jest.fn((id: string) => schedules.get(id) ?? null),
  listRunHistory: jest.fn(() => []),
  updateScheduledWorkflow: jest.fn((id: string, input: Record<string, unknown>) => {
    const current = schedules.get(id);
    if (!current) return null;
    const next = { ...current, ...input, id };
    schedules.set(id, next);
    return next;
  }),
  deleteScheduledWorkflow: jest.fn((id: string) => schedules.delete(id)),
}));

jest.mock('@/lib/workflow/schedule-run-control', () => ({
  assertScheduleCancellationResolved: (result: { allResolved: boolean; unresolvedRuns: unknown[] }, actionLabel: string) => {
    if (result.allResolved) return;
    throw new Error(`${actionLabel}前还有 ${result.unresolvedRuns.length} 个运行中的执行未确认停止`);
  },
  cancelRunningScheduleRuns: (...args: unknown[]) => mockCancelRunningScheduleRuns(...args),
}));

const mockTriggerSchedule = jest.fn(async () => undefined);

jest.mock('@/lib/scheduler/cron-engine', () => ({
  triggerSchedule: (...args: unknown[]) => mockTriggerSchedule(...args),
}));

describe('wechat assistant automations store', () => {
  beforeEach(() => {
    store.clear();
    schedules.clear();
    mockTriggerSchedule.mockClear();
    mockCancelRunningScheduleRuns.mockClear();
  });

  it('creates, updates and deletes persisted automations and backing schedules', async () => {
    const created = await createWeChatAutomation({
      name: '每日微信总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: { kind: 'wechat_summary', messageTemplate: '总结今天微信消息' },
      enabled: true,
    });

    expect(created.scheduleId).toBe('schedule-1');
    expect(listWeChatAutomations()).toEqual([created]);
    expect(schedules.get('schedule-1')).toEqual(expect.objectContaining({
      name: '微信助手 · 每日微信总结',
      intervalMinutes: 1440,
      scheduleTime: '21:00',
    }));

    const updated = await updateWeChatAutomation(created.id, {
      enabled: false,
      cronLabel: '暂停',
    });

    expect(updated).toEqual(expect.objectContaining({
      id: created.id,
      enabled: false,
      cronLabel: '暂停',
    }));
    expect(listWeChatAutomations()[0]).toEqual(updated);
    expect(schedules.get('schedule-1')).toEqual(expect.objectContaining({ enabled: false }));
    expect(mockCancelRunningScheduleRuns).toHaveBeenCalledWith(
      'schedule-1',
      '微信助手自动化已关闭，停止执行中的工作流',
      expect.objectContaining({ updateScheduleSummary: false }),
    );

    expect(await deleteWeChatAutomation(created.id)).toBe(true);
    expect(listWeChatAutomations()).toEqual([]);
    expect(schedules.has('schedule-1')).toBe(false);
  });

  it('does not delete an automation when the running workflow is not confirmed stopped', async () => {
    const created = await createWeChatAutomation({
      name: '每日微信总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: { kind: 'wechat_summary', messageTemplate: '总结今天微信消息' },
      enabled: true,
    });
    mockCancelRunningScheduleRuns.mockResolvedValueOnce({
      cancelledRuns: [unresolvedCancelRun],
      unresolvedRuns: [unresolvedCancelRun],
      allResolved: false,
    });

    await expect(deleteWeChatAutomation(created.id)).rejects.toThrow(
      '删除微信自动化前还有 1 个运行中的执行未确认停止',
    );

    expect(listWeChatAutomations()).toHaveLength(1);
    expect(listWeChatAutomations()[0]?.id).toBe(created.id);
    expect(schedules.has('schedule-1')).toBe(true);
  });

  it('parses common cron shapes into scheduler timing', () => {
    expect(parseAutomationSchedule({
      kind: 'reminder_recurring',
      cron: '0 9 * * *',
    })).toEqual(expect.objectContaining({ intervalMinutes: 1440, scheduleTime: '09:00' }));
    expect(parseAutomationSchedule({
      kind: 'reminder_recurring',
      cron: '0 9 * * 1',
    })).toEqual(expect.objectContaining({ intervalMinutes: 10080, scheduleDayOfWeek: 1 }));
    expect(parseAutomationSchedule({
      kind: 'reminder_recurring',
      cron: '0 */4 * * *',
    })).toEqual(expect.objectContaining({ intervalMinutes: 240, scheduleTime: null }));
  });

  it('builds a valid workflow notification DSL for scheduler execution', () => {
    const dsl = buildAutomationWorkflowDsl({
      id: 'a1',
      name: '国信项目提醒',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: { kind: 'custom', messageTemplate: '提醒我检查国信项目进展' },
      enabled: true,
      createdAt: 1,
    });

    const artifact = generateWorkflowFromDsl(dsl);
    expect(artifact.validation.valid).toBe(true);
    expect(artifact.manifest.stepTypes).toEqual(['notification']);
  });

  it('builds a real daily summary workflow before notifying', () => {
    const dsl = buildAutomationWorkflowDsl({
      id: 'a1',
      name: '每日微信总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: { kind: 'wechat_summary', messageTemplate: '总结今天微信消息' },
      enabled: true,
      createdAt: 1,
    });

    const artifact = generateWorkflowFromDsl(dsl);
    expect(artifact.validation.valid).toBe(true);
    expect(artifact.manifest.stepTypes).toEqual(['agent', 'notification']);
    expect(dsl.nodes[0]).toEqual(expect.objectContaining({
      id: 'generate_report',
      type: 'agent',
    }));
    expect(dsl.nodes[1]).toEqual(expect.objectContaining({
      id: 'notify',
      type: 'notification',
      input: expect.objectContaining({
        message: '{{ steps.generate_report.output.notification }}',
      }),
    }));
  });

  it('routes a custom 每日工作总结 (rich 工作群 instruction) through the real summary workflow, not echo', () => {
    // 实测 bug 复现：name/template 里 微信 与 总结 间距远超旧正则的 6 字，
    // 旧逻辑误判为普通提醒 → generic 分支把整段指令当消息发回用户。
    const dsl = buildAutomationWorkflowDsl({
      id: 'a1',
      name: '每日工作总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: {
        kind: 'custom',
        messageTemplate:
          '汇总今天，注意是今天的所有工作群微信消息，注意是工作群标签的，汇总之前，需要更新微信消息内容，提炼以下内容：1. 今日重点话题，事件。2. 今日待办事项 3. 今日需要跟进的人 4. 其他值得注意的信息。整理完成后，通过微信发送给我，如果没有，就说今日无工作。',
      },
      enabled: true,
      createdAt: 1,
    });
    const artifact = generateWorkflowFromDsl(dsl);
    expect(artifact.validation.valid).toBe(true);
    expect(artifact.manifest.stepTypes).toEqual(['agent', 'notification']);
    // 用户的详细指令通过 summary 路径透传给 handler（不再被丢弃/回显）。
    expect(JSON.stringify(dsl.nodes[0])).toContain('提炼以下内容');
  });

  it('keeps a pure reminder that merely mentions 微信 as a plain notification', () => {
    const dsl = buildAutomationWorkflowDsl({
      id: 'a2',
      name: '联系提醒',
      kind: 'reminder_recurring',
      cron: '0 9 * * *',
      cronLabel: '每天 09:00',
      action: { kind: 'custom', messageTemplate: '提醒我 9 点联系微信里的张总确认合同' },
      enabled: true,
      createdAt: 1,
    });
    const artifact = generateWorkflowFromDsl(dsl);
    expect(artifact.validation.valid).toBe(true);
    expect(artifact.manifest.stepTypes).toEqual(['notification']);
  });

  it('triggers the backing schedule for manual runs', async () => {
    const created = await createWeChatAutomation({
      name: '每日微信总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: { kind: 'wechat_summary', messageTemplate: '总结今天微信消息' },
      enabled: true,
    });

    const triggered = await triggerWeChatAutomation(created.id);

    expect(triggered?.id).toBe(created.id);
    expect(mockTriggerSchedule).toHaveBeenCalledWith('schedule-1', expect.objectContaining({
      automationId: created.id,
      source: 'wechat-assistant',
      manual: true,
    }));
  });

  it('allows retrying a schedule after the previous run failed', async () => {
    const created = await createWeChatAutomation({
      name: '每日微信总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: { kind: 'wechat_summary', messageTemplate: '总结今天微信消息' },
      enabled: true,
    });
    schedules.set('schedule-1', {
      ...schedules.get('schedule-1'),
      lastRunStatus: 'error',
      lastError: '上次同步失败',
    });

    const hydrated = listWeChatAutomations()[0];
    expect(hydrated).toEqual(expect.objectContaining({
      lastRunStatus: 'error',
      lastRunError: '上次同步失败',
    }));
    expect(hydrated?.scheduleError).toBeUndefined();

    await triggerWeChatAutomation(created.id);
    expect(mockTriggerSchedule).toHaveBeenCalledWith('schedule-1', expect.objectContaining({
      automationId: created.id,
      source: 'wechat-assistant',
      manual: true,
    }));
  });

  it('updates the backing next run time for one-time reminders', async () => {
    const firstRunAt = Date.now() + 60 * 60 * 1000;
    const secondRunAt = firstRunAt + 2 * 60 * 60 * 1000;
    const created = await createWeChatAutomation({
      name: '国信项目提醒',
      kind: 'reminder_once',
      cron: '0 9 * * *',
      cronLabel: '明天 09:00',
      action: { kind: 'custom', messageTemplate: '检查国信项目进展' },
      enabled: true,
      nextRunAt: firstRunAt,
    });

    await updateWeChatAutomation(created.id, {
      cronLabel: '明天 11:00',
      nextRunAt: secondRunAt,
    });

    expect(schedules.get('schedule-1')).toEqual(expect.objectContaining({
      runMode: 'once',
      nextRunAt: new Date(secondRunAt).toISOString(),
    }));
  });

  it('ignores malformed stored rows', () => {
    store.set('apps.wechat-assistant.automations.v1', JSON.stringify([
      { id: 'bad', name: 'x' },
      {
        id: 'ok',
        name: '有效提醒',
        kind: 'reminder_once',
        cron: '0 9 * * *',
        cronLabel: '明天 09:00',
        action: { kind: 'custom', messageTemplate: '提醒' },
        enabled: true,
        createdAt: 1,
      },
    ]));

    expect(listWeChatAutomations()).toHaveLength(1);
    expect(listWeChatAutomations()[0]?.id).toBe('ok');
  });

  it('ensureAutomationDslSchema rebuilds stale DSL + backfills summarySpec once, then is version-idempotent', async () => {
    const created = await createWeChatAutomation({
      name: '每日工作总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: {
        kind: 'custom',
        messageTemplate:
          '汇总今天所有工作群微信消息，提炼今日重点、待办、需要跟进的人；没有就说今日无工作。',
      },
      enabled: true,
    });
    const scheduleId = created.scheduleId!;
    // 模拟重构前持久化态：无 summarySpec + 存了 generic 回显 DSL + 版本落后。
    const autos = JSON.parse(store.get('apps.wechat-assistant.automations.v1')!) as Record<string, unknown>[];
    delete autos[0].summarySpec;
    store.set('apps.wechat-assistant.automations.v1', JSON.stringify(autos));
    store.delete('apps.wechat-assistant.automations.dsl-schema-version');
    schedules.set(scheduleId, {
      ...(schedules.get(scheduleId) as Record<string, unknown>),
      workflowDsl: {
        version: 'v3',
        name: 'stale',
        nodes: [{ id: 'notify', type: 'notification', input: { message: '微信助手提醒：每日工作总结' } }],
        edges: [],
      },
    });

    await ensureAutomationDslSchema();

    const dsl = (schedules.get(scheduleId) as { workflowDsl: { nodes: Array<{ id: string; type: string }> } })
      .workflowDsl;
    expect(dsl.nodes.map((n) => n.type)).toEqual(['agent', 'notification']); // DSL 重建
    const healed = JSON.parse(store.get('apps.wechat-assistant.automations.v1')!) as Array<Record<string, unknown>>;
    expect(healed[0].summarySpec).toBeTruthy(); // summarySpec 回填
    expect(store.get('apps.wechat-assistant.automations.dsl-schema-version')).toBe('3');

    // 版本已达标 → 再跑一次是 no-op（单调版本，不再每 bug 加键）。
    const before = JSON.stringify(schedules.get(scheduleId));
    await ensureAutomationDslSchema();
    expect(JSON.stringify(schedules.get(scheduleId))).toBe(before);
  });

  it('migrates the legacy enabled daily summary task into a real automation once', async () => {
    store.set('apps.wechat-assistant.tasks.v1', JSON.stringify({
      'daily-summary': {
        enabled: true,
        schedule: '22:30',
        lastRunAt: 123,
        lastResult: '旧结果',
      },
    }));

    await ensureLegacyDailySummaryAutomation();
    await ensureLegacyDailySummaryAutomation();

    const automations = listWeChatAutomations();
    expect(automations).toHaveLength(1);
    expect(automations[0]).toEqual(expect.objectContaining({
      name: '每日微信总结',
      cron: '30 22 * * *',
      cronLabel: '每天 22:30',
      enabled: true,
      action: expect.objectContaining({ kind: 'wechat_summary' }),
    }));
    expect(schedules.get('schedule-1')).toEqual(expect.objectContaining({
      name: '微信助手 · 每日微信总结',
      scheduleTime: '22:30',
    }));
  });
});

describe('deriveSummarySpec (单一意图解析器，取代 3 处启发式)', () => {
  const tag = (id: string, name: string): GroupTag =>
    ({
      id,
      name,
      rule: { kind: 'manual', members: [], matchMode: 'any', groups: [], excludeGroups: [] },
      resolved: null,
    }) as GroupTag;

  it('wechat_summary action → spec; 显式 groupTagId 进 group_tag scope', () => {
    const spec = deriveSummarySpec(
      { name: '每日微信总结', action: { kind: 'wechat_summary', messageTemplate: '总结今天微信消息', groupTagId: 'g1' } },
      [],
    );
    expect(spec?.scope).toEqual({ kind: 'group_tag', tagId: 'g1' });
    expect(spec?.extraInstruction).toBe('总结今天微信消息');
  });

  it('custom 措辞读为总结 → spec；无标签匹配则 scope=all，原话保留', () => {
    const spec = deriveSummarySpec(
      { name: '每日工作总结', action: { kind: 'custom', messageTemplate: '汇总今天工作群微信消息，提炼重点/待办/跟进人' } },
      [],
    );
    expect(spec?.scope).toEqual({ kind: 'all' });
    expect(spec?.extraInstruction).toContain('提炼重点');
  });

  it('custom 指令点名已配置标签 → scope=group_tag（最长名优先）', () => {
    const spec = deriveSummarySpec(
      { name: '每日工作总结', action: { kind: 'custom', messageTemplate: '汇总今天所有工作群-核心的微信消息，提炼重点' } },
      [tag('a', '工作群'), tag('b', '工作群-核心')],
    );
    expect(spec?.scope).toEqual({ kind: 'group_tag', tagId: 'b' });
  });

  it('纯提醒（有微信无总结动词）→ undefined', () => {
    expect(
      deriveSummarySpec(
        { name: '联系提醒', action: { kind: 'custom', messageTemplate: '提醒我9点联系微信里的张总' } },
        [],
      ),
    ).toBeUndefined();
  });

  it('探测"没有就说X"话术 → emptyMessage', () => {
    const spec = deriveSummarySpec(
      { name: '每日工作总结', action: { kind: 'custom', messageTemplate: '汇总工作群微信消息，提炼重点；如果没有就说今日无工作' } },
      [],
    );
    expect(spec?.emptyMessage).toBe('今日无工作');
  });
});
