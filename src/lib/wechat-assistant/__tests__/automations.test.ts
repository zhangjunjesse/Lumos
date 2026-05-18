import {
  createWeChatAutomation,
  deleteWeChatAutomation,
  buildAutomationWorkflowDsl,
  deriveSummarySpec,
  ensureAutomationDslSchema,
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

  it('does not silently disable an automation when the running workflow is not confirmed stopped', async () => {
    // CLAUDE.md 生命周期硬规则 + 与删除路径对等：关闭时取消没生效必须抛错，
    // 绝不"UI 显示已关闭但 run 还在跑"。
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

    await expect(updateWeChatAutomation(created.id, { enabled: false })).rejects.toThrow(
      '关闭微信自动化前还有 1 个运行中的执行未确认停止',
    );
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
    // 友好编辑器「每 N 分钟」产出的 cron 必须被引擎认（UI 能选=引擎能跑）。
    expect(parseAutomationSchedule({
      kind: 'reminder_recurring',
      cron: '*/15 * * * *',
    })).toEqual(expect.objectContaining({ intervalMinutes: 15, scheduleTime: null }));
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

  it('routes an explicit wechat_summary automation through the real summary workflow, passing the full instruction', () => {
    // 执行方式现在显式选（弹框 actionMode=summary → action.kind=wechat_summary）。
    const dsl = buildAutomationWorkflowDsl({
      id: 'a1',
      name: '每日工作总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: {
        kind: 'wechat_summary',
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

  it('never silently turns a custom reminder into a summary, even with 汇总/总结+微信 wording', () => {
    // 回归锁：旧的「总结动词+微信范围词」双信号会把普通提醒静默切成
    // 全量扫私信生成报告。custom 一律纯提醒（单 notification）。
    for (const messageTemplate of [
      '提醒我 9 点联系微信里的张总确认合同',
      '记得汇总今天的工作群微信消息进度发我', // 含 汇总+微信+群，旧逻辑会误判
    ]) {
      const dsl = buildAutomationWorkflowDsl({
        id: 'a2',
        name: '联系提醒',
        kind: 'reminder_recurring',
        cron: '0 9 * * *',
        cronLabel: '每天 09:00',
        action: { kind: 'custom', messageTemplate },
        enabled: true,
        createdAt: 1,
      });
      const artifact = generateWorkflowFromDsl(dsl);
      expect(artifact.validation.valid).toBe(true);
      expect(artifact.manifest.stepTypes).toEqual(['notification']);
    }
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

  it('refuses to manually run a disabled automation (UI 藏按钮 + 决策点强约束一致)', async () => {
    const created = await createWeChatAutomation({
      name: '每日微信总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: { kind: 'wechat_summary', messageTemplate: '总结今天微信消息' },
      enabled: true,
    });
    await updateWeChatAutomation(created.id, { enabled: false });
    mockTriggerSchedule.mockClear();

    await expect(triggerWeChatAutomation(created.id)).rejects.toThrow('这条自动化已停用，先启用再运行');
    expect(mockTriggerSchedule).not.toHaveBeenCalled();
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

  it('reconciles a stale summarySpec on a custom automation away (kind 是唯一真源)', async () => {
    // 用户把执行方式改回纯提醒（action.kind=custom）后，遗留的 summarySpec
    // 必须被剥除——否则弹框选的纯提醒形同虚设，仍跑总结流程。
    const created = await createWeChatAutomation({
      name: '客户提醒',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: { kind: 'custom', messageTemplate: '提醒我跟进重点客户' },
      enabled: true,
    });
    const autos = JSON.parse(store.get('apps.wechat-assistant.automations.v1')!) as Record<string, unknown>[];
    autos[0].summarySpec = { scope: { kind: 'all' }, extraInstruction: '旧文本判定残留' };
    store.set('apps.wechat-assistant.automations.v1', JSON.stringify(autos));
    store.delete('apps.wechat-assistant.automations.dsl-schema-version');

    await ensureAutomationDslSchema();

    const healed = JSON.parse(store.get('apps.wechat-assistant.automations.v1')!) as Record<string, unknown>[];
    expect(healed[0].summarySpec).toBeUndefined(); // 剥除，回归纯提醒
    const dsl = (schedules.get(created.scheduleId!) as { workflowDsl: { nodes: Array<{ type: string }> } }).workflowDsl;
    expect(dsl.nodes.map((n) => n.type)).toEqual(['notification']);
  });

  it('ensureAutomationDslSchema rebuilds stale DSL + backfills summarySpec once, then is version-idempotent', async () => {
    const created = await createWeChatAutomation({
      name: '每日工作总结',
      kind: 'reminder_recurring',
      cron: '0 21 * * *',
      cronLabel: '每天 21:00',
      action: {
        kind: 'wechat_summary',
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

  it('does not auto-seed an automation from a legacy enabled daily summary task', async () => {
    // 用户从未要求过"内置任务"：列表/Schema 路径不得偷偷 seed 一条总结自动化。
    store.set('apps.wechat-assistant.tasks.v1', JSON.stringify({
      'daily-summary': {
        enabled: true,
        schedule: '22:30',
        lastRunAt: 123,
        lastResult: '旧结果',
      },
    }));

    await ensureAutomationDslSchema();

    expect(listWeChatAutomations()).toEqual([]);
    expect(schedules.size).toBe(0);
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

  it('wechat_summary 无显式 tagId，指令点名已配置标签 → scope=group_tag（最长名优先）', () => {
    const spec = deriveSummarySpec(
      { name: '每日工作总结', action: { kind: 'wechat_summary', messageTemplate: '汇总今天所有工作群-核心的微信消息，提炼重点' } },
      [tag('a', '工作群'), tag('b', '工作群-核心')],
    );
    expect(spec?.scope).toEqual({ kind: 'group_tag', tagId: 'b' });
  });

  it('custom 一律 undefined——即使含「汇总/总结+微信」也不静默判总结（杜绝误判）', () => {
    for (const messageTemplate of [
      '提醒我9点联系微信里的张总',
      '汇总今天工作群微信消息，提炼重点/待办/跟进人', // 旧双信号会误判为总结
      '梳理一下本周客户群进展',
    ]) {
      expect(
        deriveSummarySpec({ name: '提醒', action: { kind: 'custom', messageTemplate } }, [
          tag('a', '工作群'),
        ]),
      ).toBeUndefined();
    }
  });

  it('探测"没有就说X"话术 → emptyMessage（显式 wechat_summary）', () => {
    const spec = deriveSummarySpec(
      { name: '每日工作总结', action: { kind: 'wechat_summary', messageTemplate: '汇总工作群微信消息，提炼重点；如果没有就说今日无工作' } },
      [],
    );
    expect(spec?.emptyMessage).toBe('今日无工作');
  });
});
