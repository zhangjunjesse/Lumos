import Database from 'better-sqlite3';

let mockDb: Database.Database;

jest.mock('../index', () => ({
  getDb: () => mockDb,
}));

import {
  advanceScheduleTimer,
  createScheduledWorkflow,
  getScheduledWorkflow,
  listDueSchedules,
  recordScheduleRun,
  updateScheduledWorkflow,
} from '../scheduled-workflows';

const workflowDsl = {
  version: 'v3',
  name: '测试工作流',
  nodes: [],
  edges: [],
} as const;

describe('scheduled workflows timing', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.exec(`
      CREATE TABLE scheduled_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workflow_dsl TEXT NOT NULL,
        workflow_id TEXT,
        run_mode TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        schedule_time TEXT,
        schedule_day_of_week INTEGER,
        working_directory TEXT NOT NULL DEFAULT '',
        browser_context_id TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        notify_on_complete INTEGER NOT NULL DEFAULT 1,
        run_params TEXT NOT NULL DEFAULT '{}',
        last_run_at TEXT,
        next_run_at TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        last_run_status TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    mockDb.close();
  });

  it('persists explicit nextRunAt updates for one-time schedules', () => {
    const firstRunAt = '2099-01-01T01:00:00.000Z';
    const secondRunAt = '2099-01-01T03:00:00.000Z';
    const schedule = createScheduledWorkflow({
      name: '一次性提醒',
      workflowDsl,
      runMode: 'once',
      intervalMinutes: 0,
      nextRunAt: firstRunAt,
    });

    const updated = updateScheduledWorkflow(schedule.id, {
      runMode: 'once',
      intervalMinutes: 0,
      nextRunAt: secondRunAt,
    });

    expect(updated?.nextRunAt).toBe(secondRunAt);
    expect(getScheduledWorkflow(schedule.id)?.nextRunAt).toBe(secondRunAt);
  });

  it('disables a due one-time schedule when advancing the timer', () => {
    const schedule = createScheduledWorkflow({
      name: '到点一次性提醒',
      workflowDsl,
      runMode: 'once',
      intervalMinutes: 0,
      nextRunAt: '2000-01-01T00:00:00.000Z',
    });

    expect(listDueSchedules().map((item) => item.id)).toContain(schedule.id);

    advanceScheduleTimer(schedule.id);

    const advanced = getScheduledWorkflow(schedule.id);
    expect(advanced).toEqual(expect.objectContaining({
      enabled: false,
      nextRunAt: null,
    }));
    expect(listDueSchedules().map((item) => item.id)).not.toContain(schedule.id);
  });

  it('does not compute another next run after a one-time schedule reaches a terminal state', () => {
    const schedule = createScheduledWorkflow({
      name: '一次性提醒',
      workflowDsl,
      runMode: 'once',
      intervalMinutes: 0,
      nextRunAt: '2099-01-01T01:00:00.000Z',
    });

    recordScheduleRun(schedule.id, 'success');

    expect(getScheduledWorkflow(schedule.id)).toEqual(expect.objectContaining({
      runCount: 1,
      lastRunStatus: 'success',
      nextRunAt: null,
    }));
  });
});
