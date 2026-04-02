import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createTeamRunSkeleton,
  parseTeamPlanTaskRecord,
  serializeTeamPlanTaskRecord,
  TEAM_PLAN_TASK_KIND,
} from '@/types';

function buildPlan() {
  return {
    version: 1 as const,
    summary: 'Ship team runtime foundation',
    activationReason: 'main_agent_suggested' as const,
    userGoal: 'Replace the fake team task automation path.',
    expectedOutcome: 'Canonical team task storage with runtime handoff.',
    roles: [
      {
        id: 'main',
        name: 'Main Agent',
        kind: 'main_agent' as const,
        responsibility: 'User-facing coordination',
      },
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        kind: 'orchestrator' as const,
        responsibility: 'Compile and supervise execution',
      },
      {
        id: 'worker',
        name: 'Worker',
        kind: 'worker' as const,
        responsibility: 'Implement the assigned stage',
      },
    ],
    tasks: [
      {
        id: 'plan-storage',
        title: 'Persist task metadata',
        ownerRoleId: 'orchestrator',
        summary: 'Write team plan metadata into canonical task columns.',
        dependsOn: [],
        expectedOutput: 'Task row stores canonical team-plan fields.',
      },
      {
        id: 'runtime-sync',
        title: 'Project runtime state',
        ownerRoleId: 'worker',
        summary: 'Create runtime rows and project them back to task views.',
        dependsOn: ['plan-storage'],
        expectedOutput: 'Runtime rows are readable through the task API.',
      },
    ],
  };
}

describe('team plan task storage', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-team-task-test-'));
    delete process.env.LUMOS_DATA_DIR;
    process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
    fs.writeFileSync(path.join(tmpDir, 'lumos.db'), '');
    jest.resetModules();
  });

  afterEach(() => {
    const { closeDb } = require('../../db') as typeof import('../../db');
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_GUI_DATA_DIR;
    jest.resetModules();
  });

  it('stores new team plans in canonical task columns', () => {
    const { createSession, getDb } = require('../../db') as typeof import('../../db');
    const { upsertTeamPlanTask, getTasksBySession } = require('../tasks') as typeof import('../tasks');

    const session = createSession('Team Plan Session');
    const task = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan: buildPlan(),
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(buildPlan()),
      sourceMessageId: 'msg-team-plan-001',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const raw = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Record<string, unknown>;
    expect(raw.task_kind).toBe('team_plan');
    expect(raw.team_plan_json).toBeTruthy();
    expect(raw.team_approval_status).toBe('pending');
    expect(raw.current_run_id).toBeNull();
    expect(raw.description).toBeNull();

    const tasks = getTasksBySession(session.id, { kind: TEAM_PLAN_TASK_KIND });
    expect(tasks).toHaveLength(1);
    expect(parseTeamPlanTaskRecord(tasks[0].description)?.plan.summary).toBe('Ship team runtime foundation');
  });


  it('keeps legacy description-only team tasks readable', () => {
    const { createSession } = require('../../db') as typeof import('../../db');
    const { createTask, getTask } = require('../tasks') as typeof import('../tasks');

    const plan = buildPlan();
    const run = createTeamRunSkeleton(plan);
    const completedRun = {
      ...run,
      status: 'done' as const,
      phases: run.phases.map((phase) => ({
        ...phase,
        status: 'done' as const,
        latestResult: `${phase.title} done`,
      })),
      context: {
        ...run.context,
        finalSummary: 'Legacy team task completed.',
      },
    };

    const session = createSession('Legacy Team Session');
    const legacy = createTask(
      session.id,
      plan.summary,
      serializeTeamPlanTaskRecord({
        kind: TEAM_PLAN_TASK_KIND,
        plan,
        approvalStatus: 'approved',
        run: completedRun,
        approvedAt: '2026-03-14T00:00:00.000Z',
        rejectedAt: null,
        lastActionAt: '2026-03-14T00:00:00.000Z',
      }),
    );

    const fetched = getTask(legacy.id);
    const record = parseTeamPlanTaskRecord(fetched?.description);

    expect(record).not.toBeNull();
    expect(record?.run.status).toBe('done');
    expect(record?.run.context.finalSummary).toBe('Legacy team task completed.');
  });

});
