import fs from 'fs';
import os from 'os';
import path from 'path';
import { MAIN_AGENT_SESSION_MARKER } from '@/lib/chat/session-entry';
import {
  createTeamRunSkeleton,
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

describe('team runtime projections', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-team-projection-test-'));
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

  it('builds session banner projections from canonical team tasks', () => {
    const { createSession } = require('../../db') as typeof import('../../db');
    const { upsertTeamPlanTask } = require('../../db/tasks') as typeof import('../../db/tasks');
    const { getSessionTeamBannerProjection } = require('../projections') as typeof import('../projections');

    const plan = buildPlan();
    const session = createSession('Main Agent Session', undefined, MAIN_AGENT_SESSION_MARKER);

    upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'rejected',
      run: createTeamRunSkeleton(plan),
      approvedAt: null,
      rejectedAt: new Date().toISOString(),
      lastActionAt: new Date().toISOString(),
    });

    const latest = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(plan),
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const banner = getSessionTeamBannerProjection(session.id);
    expect(banner).not.toBeNull();
    expect(banner?.taskId).toBe(latest.id);
    expect(banner?.approvalStatus).toBe('pending');
    expect(banner?.historyCount).toBe(2);
    expect(banner?.recent).toHaveLength(2);
    expect(banner?.workspace?.plan.summary).toBe(plan.summary);
  });

});
