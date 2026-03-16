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

  it('builds task and run detail projections from the real runtime rows', () => {
    const { createSession, getDb } = require('../../db') as typeof import('../../db');
    const { upsertTeamPlanTask, updateTeamPlanApproval, getTask } = require('../../db/tasks') as typeof import('../../db/tasks');
    const {
      getTaskViewProjection,
      getTeamRunDetailProjection,
      getMainAgentCatalogProjection,
    } = require('../projections') as typeof import('../projections');

    const plan = buildPlan();
    const session = createSession('Main Agent Session', undefined, MAIN_AGENT_SESSION_MARKER);
    const created = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(plan),
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const approved = updateTeamPlanApproval(created.id, 'approved');
    const refreshed = getTask(created.id);

    expect(approved?.current_run_id).toBeTruthy();

    const db = getDb();
    const runtimeStages = db.prepare(`
      SELECT id, plan_task_id
      FROM team_run_stages
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(approved?.current_run_id) as Array<{ id: string; plan_task_id: string }>;
    const stageIdByPlanTaskId = new Map(runtimeStages.map((stage) => [stage.plan_task_id, stage.id]));
    const planStorageStageId = stageIdByPlanTaskId.get('plan-storage');
    const runtimeSyncStageId = stageIdByPlanTaskId.get('runtime-sync');

    expect(planStorageStageId).toBeTruthy();
    expect(runtimeSyncStageId).toBeTruthy();

    db.prepare(`
      INSERT INTO team_run_artifacts (id, run_id, stage_id, type, title, source_path, content, content_type, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'artifact-report-001',
      approved?.current_run_id,
      planStorageStageId,
      'metadata',
      'Stage report',
      'report.md',
      Buffer.from('# Report'),
      'text/markdown',
      Buffer.byteLength('# Report'),
      Date.now(),
    );
    db.prepare(`
      INSERT INTO team_run_artifacts (id, run_id, stage_id, type, title, source_path, content, content_type, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'artifact-log-001',
      approved?.current_run_id,
      runtimeSyncStageId,
      'log',
      'Execution log',
      'runtime.log',
      Buffer.from('ok'),
      'text/plain',
      Buffer.byteLength('ok'),
      Date.now() + 1,
    );

    const taskView = getTaskViewProjection(created.id);
    expect(taskView?.task.runStatus).toBe('ready');
    expect(taskView?.workspace?.runId).toBe(approved?.current_run_id);
    expect(taskView?.task.runtimeArtifacts).toEqual([
      expect.objectContaining({
        artifactId: 'artifact-report-001',
        title: 'Stage report',
        type: 'metadata',
        previewable: true,
        previewKind: 'markdown',
        stageId: planStorageStageId,
        stageTitle: 'Persist task metadata',
        sourcePath: 'report.md',
      }),
      expect.objectContaining({
        artifactId: 'artifact-log-001',
        title: 'Execution log',
        type: 'log',
        previewable: true,
        previewKind: 'text',
        stageId: runtimeSyncStageId,
        stageTitle: 'Project runtime state',
        sourcePath: 'runtime.log',
      }),
    ]);

    const runView = getTeamRunDetailProjection(approved?.current_run_id || '');
    expect(runView?.runId).toBe(approved?.current_run_id);
    expect(runView?.stages).toHaveLength(plan.tasks.length);
    expect(runView?.projectionVersion).toBeGreaterThan(0);
    expect(runView?.runtimeArtifacts).toHaveLength(2);
    expect(runView?.stages.find((stage) => stage.stageId === planStorageStageId)?.artifacts).toEqual([
      expect.objectContaining({
        artifactId: 'artifact-report-001',
        title: 'Stage report',
        type: 'metadata',
        previewable: true,
        previewKind: 'markdown',
      }),
    ]);
    expect(runView?.stages.find((stage) => stage.stageId === runtimeSyncStageId)?.artifacts).toEqual([
      expect.objectContaining({
        artifactId: 'artifact-log-001',
        title: 'Execution log',
        type: 'log',
        previewable: true,
        previewKind: 'text',
      }),
    ]);

    const catalog = getMainAgentCatalogProjection();
    expect(catalog.tasks.find((item) => item.id === created.id)?.runId).toBe(approved?.current_run_id);
    expect(catalog.teams.find((item) => item.id === created.id)?.runId).toBe(refreshed?.current_run_id);
  });
});
