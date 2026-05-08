import type { ScheduledWorkflow } from '@/lib/db/scheduled-workflows';
import type { WorkflowDSLV3 } from '@/lib/workflow/types';

import {
  buildNativeAutomationWorkflowDsl,
  parseNativeAutomationSchedule,
  syncNativeAppAutomationSchedule,
} from '../native-automation-scheduler';
import type { AppManifest } from '../manifest/types';
import type { AppDataStore, AppRow, QueryOptions } from '../runtime/data-store';

const manifest: AppManifest = {
  id: 'goofish-assistant',
  name: '闲鱼助手',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'inbox',
  tags: ['闲鱼'],
  permissions: { data: 'isolated', system: ['schedule'] },
};

describe('native app automation scheduler', () => {
  it('parses supported user-facing schedule text', () => {
    expect(parseNativeAutomationSchedule('每天 09:30')).toEqual(expect.objectContaining({
      intervalMinutes: 1440,
      scheduleTime: '09:30',
    }));
    expect(parseNativeAutomationSchedule('每 2 小时')).toEqual(expect.objectContaining({
      intervalMinutes: 120,
      scheduleTime: null,
    }));
    expect(parseNativeAutomationSchedule('*/30 * * * *')).toEqual(expect.objectContaining({
      intervalMinutes: 30,
    }));
    expect(parseNativeAutomationSchedule('手动触发')).toBeNull();
  });

  it('builds a workflow DSL that runs the native app automation handler', () => {
    const dsl = buildNativeAutomationWorkflowDsl({
      appId: 'goofish-assistant',
      appName: '闲鱼助手',
      automationId: 'auto-sync',
      automationTitle: '同步闲鱼数据',
      nativeAction: 'goofish:sync',
    });

    expect(dsl.nodes[0]).toEqual(expect.objectContaining({
      id: 'run_automation',
      type: 'agent',
      input: expect.objectContaining({
        code: expect.objectContaining({
          handler: 'native-app.run-automation',
          strategy: 'code-only',
          params: expect.objectContaining({
            appId: 'goofish-assistant',
            automationId: 'auto-sync',
            nativeAction: 'goofish:sync',
          }),
        }),
      }),
    }));
  });

  it('creates a scheduled workflow and writes app-visible schedule status', async () => {
    const store = createMemoryStore();
    store.create('app_automations', {
      id: 'auto-sync',
      title: '同步闲鱼数据',
      enabled: true,
      schedule: '每天 09:30',
      native_action: 'goofish:sync',
      last_status: 'idle',
    });
    const createSchedule = jest.fn((input) => makeSchedule({
      id: 'schedule-1',
      name: input.name,
      workflowDsl: input.workflowDsl,
      intervalMinutes: input.intervalMinutes,
      scheduleTime: input.scheduleTime ?? null,
      nextRunAt: '2026-05-08T01:30:00.000Z',
    }));

    const result = await syncNativeAppAutomationSchedule({
      appId: 'goofish-assistant',
      manifest,
      store,
      rowId: 'auto-sync',
      deps: {
        now: () => 1778160000000,
        createSchedule,
        getSchedule: () => null,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.scheduleId).toBe('schedule-1');
    expect(createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      name: '应用自动化 · 闲鱼助手 · 同步闲鱼数据',
      intervalMinutes: 1440,
      scheduleTime: '09:30',
      runParams: expect.objectContaining({
        appId: 'goofish-assistant',
        automationId: 'auto-sync',
        nativeAction: 'goofish:sync',
      }),
    }));
    expect(store.get('app_automations', 'auto-sync')).toEqual(expect.objectContaining({
      schedule_id: 'schedule-1',
      schedule_status: 'scheduled',
      schedule_error: '',
      next_run_at: '2026-05-08T01:30:00.000Z',
      last_run_summary: expect.stringContaining('已同步定时任务'),
    }));
    expect(store.query('run_history')).toEqual([
      expect.objectContaining({
        title: '同步定时任务：同步闲鱼数据',
        status: 'success',
      }),
    ]);
  });

  it('pauses an existing schedule when the automation is disabled', async () => {
    const store = createMemoryStore();
    store.create('app_automations', {
      id: 'auto-sync',
      title: '同步闲鱼数据',
      enabled: false,
      schedule: '每天 09:30',
      native_action: 'goofish:sync',
      schedule_id: 'schedule-1',
      schedule_status: 'scheduled',
    });
    const updateSchedule = jest.fn(() => makeSchedule({
      id: 'schedule-1',
      enabled: false,
      nextRunAt: null,
    }));
    const cancelRunningScheduleRuns = jest.fn(async () => ({
      cancelledRuns: [],
      unresolvedRuns: [],
      allResolved: true,
    }));

    const result = await syncNativeAppAutomationSchedule({
      appId: 'goofish-assistant',
      manifest,
      store,
      rowId: 'auto-sync',
      deps: {
        updateSchedule,
        cancelRunningScheduleRuns,
      },
    });

    expect(result.ok).toBe(true);
    expect(cancelRunningScheduleRuns).toHaveBeenCalledWith(
      'schedule-1',
      '应用自动化已关闭，停止执行中的定时任务',
      { updateScheduleSummary: false },
    );
    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', { enabled: false, nextRunAt: null });
    expect(store.get('app_automations', 'auto-sync')).toEqual(expect.objectContaining({
      schedule_status: 'paused',
      next_run_at: null,
      last_run_summary: '自动化未启用；定时任务已暂停。',
    }));
  });

  it('fails visibly when the schedule text is not executable', async () => {
    const store = createMemoryStore();
    store.create('app_automations', {
      id: 'auto-sync',
      title: '同步闲鱼数据',
      enabled: true,
      schedule: '手动触发',
      native_action: 'goofish:sync',
    });

    const result = await syncNativeAppAutomationSchedule({
      appId: 'goofish-assistant',
      manifest,
      store,
      rowId: 'auto-sync',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('触发规则');
    expect(store.get('app_automations', 'auto-sync')).toEqual(expect.objectContaining({
      schedule_status: 'not_connected',
      schedule_error: '触发规则暂不能自动执行。',
    }));
  });
});

function makeSchedule(patch: Partial<ScheduledWorkflow> = {}): ScheduledWorkflow {
  return {
    id: patch.id ?? 'schedule-1',
    name: patch.name ?? '应用自动化',
    workflowDsl: patch.workflowDsl ?? ({ version: 'v3', name: '应用自动化', nodes: [], edges: [] } as WorkflowDSLV3),
    workflowId: patch.workflowId ?? null,
    runMode: patch.runMode ?? 'scheduled',
    intervalMinutes: patch.intervalMinutes ?? 1440,
    scheduleTime: patch.scheduleTime ?? null,
    scheduleDayOfWeek: patch.scheduleDayOfWeek ?? null,
    workingDirectory: patch.workingDirectory ?? '',
    browserContextId: patch.browserContextId ?? 'embedded:default',
    enabled: patch.enabled ?? true,
    notifyOnComplete: patch.notifyOnComplete ?? true,
    runParams: patch.runParams ?? {},
    lastRunAt: patch.lastRunAt ?? null,
    nextRunAt: patch.nextRunAt === undefined ? '2026-05-08T01:30:00.000Z' : patch.nextRunAt,
    runCount: patch.runCount ?? 0,
    lastRunStatus: patch.lastRunStatus ?? '',
    lastError: patch.lastError ?? '',
    createdAt: patch.createdAt ?? '2026-05-08 00:00:00',
    updatedAt: patch.updatedAt ?? '2026-05-08 00:00:00',
  };
}

function createMemoryStore(): AppDataStore {
  const collections = new Map<string, Map<string, AppRow>>();
  let counter = 0;
  const collection = (name: string) => {
    let rows = collections.get(name);
    if (!rows) {
      rows = new Map();
      collections.set(name, rows);
    }
    return rows;
  };
  return {
    query<T = Record<string, unknown>>(name: string, opts: QueryOptions = {}): AppRow<T>[] {
      let rows = Array.from(collection(name).values()) as AppRow<T>[];
      if (opts.limit !== undefined) rows = rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit);
      return rows;
    },
    get<T = Record<string, unknown>>(name: string, id: string): AppRow<T> | null {
      return (collection(name).get(id) as AppRow<T> | undefined) ?? null;
    },
    create<T extends Record<string, unknown>>(name: string, data: T & { id?: string }): AppRow<T> {
      const id = data.id ?? `row-${++counter}`;
      const { id: _ignored, ...rest } = data;
      void _ignored;
      const row = { ...rest, id } as AppRow<T>;
      collection(name).set(id, row);
      return row;
    },
    update<T extends Record<string, unknown>>(name: string, id: string, patch: Partial<T>): AppRow<T> | null {
      const existing = collection(name).get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, id } as AppRow<T>;
      collection(name).set(id, next);
      return next;
    },
    delete(name: string, id: string): boolean {
      return collection(name).delete(id);
    },
    count(name: string): number {
      return collection(name).size;
    },
  };
}
