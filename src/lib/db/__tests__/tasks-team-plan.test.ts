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

  it('creates runtime rows when a team plan is approved', () => {
    const { createSession, getDb } = require('../../db') as typeof import('../../db');
    const { upsertTeamPlanTask, updateTeamPlanApproval } = require('../tasks') as typeof import('../tasks');

    const plan = buildPlan();
    const session = createSession('Team Approval Session');
    const created = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(plan),
      sourceMessageId: 'msg-team-plan-002',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const approved = updateTeamPlanApproval(created.id, 'approved');
    const record = parseTeamPlanTaskRecord(approved?.description);

    expect(approved?.current_run_id).toBeTruthy();
    expect(record?.approvalStatus).toBe('approved');
    expect(record?.run.status).toBe('ready');
    expect(record?.run.phases).toHaveLength(plan.tasks.length);

    const rawRun = getDb()
      .prepare('SELECT * FROM team_runs WHERE id = ?')
      .get(approved?.current_run_id) as Record<string, unknown>;
    const rawStages = getDb()
      .prepare('SELECT COUNT(*) as count FROM team_run_stages WHERE run_id = ?')
      .get(approved?.current_run_id) as { count: number };

    expect(rawRun.task_id).toBe(created.id);
    expect(rawRun.status).toBe('ready');
    expect(rawStages.count).toBe(plan.tasks.length);
  });

  it('resolves agent presets into the compiled run plan at approval time', () => {
    const { createSession, getDb } = require('../../db') as typeof import('../../db');
    const {
      createMainAgentAgentPreset,
      upsertTeamPlanTask,
      updateTeamPlanApproval,
    } = require('../tasks') as typeof import('../tasks');

    const orchestratorPreset = createMainAgentAgentPreset({
      name: 'Orchestrator',
      roleKind: 'orchestrator',
      responsibility: 'Compile and supervise execution',
      systemPrompt: 'Preset orchestrator system prompt.',
      collaborationStyle: 'Route all coordination through the scheduler.',
      outputContract: 'Return stage execution summaries only.',
    });
    const workerPreset = createMainAgentAgentPreset({
      name: 'Implementation Worker',
      roleKind: 'worker',
      responsibility: 'Implement the assigned stage',
      systemPrompt: 'Preset worker system prompt.',
    });

    const plan = buildPlan();
    const session = createSession('Team Preset Session');
    const created = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(plan),
      sourceMessageId: 'msg-team-plan-003',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const approved = updateTeamPlanApproval(created.id, 'approved');
    const rawRun = getDb()
      .prepare('SELECT compiled_plan_json FROM team_runs WHERE id = ?')
      .get(approved?.current_run_id) as { compiled_plan_json: string };
    const compiledPlan = JSON.parse(rawRun.compiled_plan_json) as {
      roles: Array<{
        externalRoleId: string;
        presetId?: string;
        agentDefinitionId?: string;
        systemPrompt?: string;
        memoryPolicy?: string;
        allowedTools?: string[];
        outputSchema?: string;
        agentType?: string;
      }>;
    };
    const rawStages = getDb()
      .prepare('SELECT plan_task_id, agent_definition_id FROM team_run_stages WHERE run_id = ? ORDER BY plan_task_id ASC')
      .all(approved?.current_run_id) as Array<{ plan_task_id: string; agent_definition_id: string | null }>;

    const orchestratorRole = compiledPlan.roles.find((role) => role.externalRoleId === 'orchestrator');
    const workerRole = compiledPlan.roles.find((role) => role.externalRoleId === 'worker');
    const mainRole = compiledPlan.roles.find((role) => role.externalRoleId === 'main');

    expect(orchestratorRole?.presetId).toBe(orchestratorPreset.id);
    expect(orchestratorRole?.agentDefinitionId).toBe(`agent-def:${orchestratorPreset.id}`);
    expect(orchestratorRole?.systemPrompt).toContain('Preset orchestrator system prompt.');
    expect(orchestratorRole?.systemPrompt).toContain('Runtime Role Name: Orchestrator');
    expect(orchestratorRole?.memoryPolicy).toBe('sticky-run');

    expect(workerRole?.presetId).toBe(workerPreset.id);
    expect(workerRole?.agentDefinitionId).toBe(`agent-def:${workerPreset.id}`);
    expect(workerRole?.systemPrompt).toContain('Preset worker system prompt.');
    expect(workerRole?.allowedTools).toEqual(['workspace.read', 'workspace.write', 'shell.exec']);
    expect(workerRole?.outputSchema).toBe('stage-execution-result/v1');

    expect(mainRole?.presetId).toBeUndefined();
    expect(mainRole?.agentType).toBe('main_agent.control');

    expect(rawStages).toEqual([
      { plan_task_id: 'plan-storage', agent_definition_id: `agent-def:${orchestratorPreset.id}` },
      { plan_task_id: 'runtime-sync', agent_definition_id: `agent-def:${workerPreset.id}` },
    ]);
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

  it('builds a main-agent runtime prompt from completed team task state', () => {
    const { createSession, getDb } = require('../../db') as typeof import('../../db');
    const {
      getMainAgentSessionTeamRuntimePrompt,
      upsertTeamPlanTask,
      updateTeamPlanApproval,
    } = require('../tasks') as typeof import('../tasks');

    const plan = buildPlan();
    const session = createSession('Main Agent Runtime Prompt Session');
    const created = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(plan),
      sourceMessageId: 'msg-team-plan-004',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const approved = updateTeamPlanApproval(created.id, 'approved');
    const db = getDb();
    const compiledPlanRow = db.prepare(`
      SELECT compiled_plan_json
      FROM team_runs
      WHERE id = ?
    `).get(approved?.current_run_id) as { compiled_plan_json: string };
    const compiledPlan = JSON.parse(compiledPlanRow.compiled_plan_json) as {
      runtimeMeta?: Record<string, unknown>
    };
    db.prepare(`
      UPDATE team_runs
      SET status = ?, summary = ?, final_summary = ?, completed_at = ?, published_at = ?, compiled_plan_json = ?
      WHERE id = ?
    `).run(
      'done',
      'Internal team summary',
      'Midscene automation guide is ready for delivery.',
      Date.now(),
      '2026-03-15T08:00:00.000Z',
      JSON.stringify({
        ...compiledPlan,
        runtimeMeta: {
          ...(compiledPlan.runtimeMeta || {}),
          finalSummarySource: 'manual',
        },
      }),
      approved?.current_run_id,
    );
    db.prepare(`
      UPDATE team_run_stages
      SET status = ?, latest_result = ?, completed_at = ?, updated_at = ?
      WHERE run_id = ?
    `).run(
      'done',
      'Stage completed.',
      Date.now(),
      Date.now(),
      approved?.current_run_id,
    );
    const stage = db.prepare(`
      SELECT id
      FROM team_run_stages
      WHERE run_id = ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(approved?.current_run_id) as { id: string };
    db.prepare(`
      INSERT INTO team_run_artifacts (id, run_id, stage_id, type, title, source_path, content, content_type, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'artifact-final-summary-001',
      approved?.current_run_id,
      stage.id,
      'output',
      'Final summary',
      'final-summary.md',
      Buffer.from('# Final Summary\nArtifact copy'),
      'text/markdown',
      Buffer.byteLength('# Final Summary\nArtifact copy', 'utf8'),
      Date.now(),
    );

    const prompt = getMainAgentSessionTeamRuntimePrompt(session.id);

    expect(prompt).toContain('Team task runtime state is available for this Main Agent session.')
    expect(prompt).toContain('use the completed task state below instead of saying execution has not happened')
    expect(prompt).toContain(`Task: ${plan.summary}`)
    expect(prompt).toContain('Run status: done')
    expect(prompt).toContain('Published to chat: yes')
    expect(prompt).toContain('Final summary: Midscene automation guide is ready for delivery.')
    expect(prompt).toContain(`/api/team-runs/${approved?.current_run_id}/artifacts/artifact-final-summary-001`)
    expect(prompt).toContain(`Run ID: ${approved?.current_run_id}`)
  });

  it('backfills a final summary artifact for older completed runs when the main agent runtime prompt is requested', () => {
    const { createSession, getDb } = require('../../db') as typeof import('../../db');
    const {
      getMainAgentSessionTeamRuntimePrompt,
      upsertTeamPlanTask,
      updateTeamPlanApproval,
    } = require('../tasks') as typeof import('../tasks');

    const plan = buildPlan();
    const session = createSession('Main Agent Runtime Artifact Backfill Session');
    const created = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(plan),
      sourceMessageId: 'msg-team-plan-legacy-summary-001',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const approved = updateTeamPlanApproval(created.id, 'approved');
    const db = getDb();
    db.prepare(`
      UPDATE team_runs
      SET status = ?, final_summary = ?, completed_at = ?
      WHERE id = ?
    `).run(
      'done',
      'Backfilled final summary.',
      Date.now(),
      approved?.current_run_id,
    );
    db.prepare(`
      UPDATE team_run_stages
      SET status = ?, completed_at = ?, updated_at = ?
      WHERE run_id = ?
    `).run(
      'done',
      Date.now(),
      Date.now(),
      approved?.current_run_id,
    );

    const prompt = getMainAgentSessionTeamRuntimePrompt(session.id);
    const artifact = db.prepare(`
      SELECT id
      FROM team_run_artifacts
      WHERE run_id = ? AND source_path = 'final-summary.md'
      LIMIT 1
    `).get(approved?.current_run_id) as { id: string } | undefined;

    expect(artifact).toBeTruthy();
    expect(prompt).toContain(`/api/team-runs/${approved?.current_run_id}/artifacts/${artifact?.id}`);
  });

  it('finds a team plan task by source message id inside the same session', () => {
    const { createSession } = require('../../db') as typeof import('../../db');
    const {
      getTeamPlanTaskBySourceMessageId,
      upsertTeamPlanTask,
    } = require('../tasks') as typeof import('../tasks');

    const session = createSession('Team Source Message Session');
    const created = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan: buildPlan(),
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(buildPlan()),
      sourceMessageId: 'msg-team-plan-inline-001',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const found = getTeamPlanTaskBySourceMessageId(session.id, 'msg-team-plan-inline-001');

    expect(found?.id).toBe(created.id);
    expect(found?.source_message_id).toBe('msg-team-plan-inline-001');
  });

  it('prioritizes approved runtime state over older pending team plans in the main-agent prompt', () => {
    const { createSession } = require('../../db') as typeof import('../../db');
    const {
      getMainAgentSessionTeamRuntimePrompt,
      upsertTeamPlanTask,
      updateTeamPlanApproval,
    } = require('../tasks') as typeof import('../tasks');

    const session = createSession('Team Runtime Prompt Priority Session');
    upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan: {
        ...buildPlan(),
        summary: 'Older pending plan',
      },
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(buildPlan()),
      sourceMessageId: 'msg-team-plan-older-pending',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    const created = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan: {
        ...buildPlan(),
        summary: 'Approved active plan',
      },
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(buildPlan()),
      sourceMessageId: 'msg-team-plan-approved',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    updateTeamPlanApproval(created.id, 'approved');
    const prompt = getMainAgentSessionTeamRuntimePrompt(session.id);

    expect(prompt).toContain('Primary team task to use as current truth:')
    expect(prompt).toContain('Task: Approved active plan')
    expect(prompt).not.toContain('Task: Older pending plan')
    expect(prompt).toContain('do not ask the user to approve or confirm it again')
    expect(prompt).toContain('do not volunteer team approval reminders')
  });

  it('keeps an active approved task as the primary truth even if more than four newer pending plans exist', () => {
    const { createSession } = require('../../db') as typeof import('../../db');
    const {
      getMainAgentSessionTeamRuntimePrompt,
      upsertTeamPlanTask,
      updateTeamPlanApproval,
    } = require('../tasks') as typeof import('../tasks');

    const session = createSession('Team Runtime Prompt Recency Session');
    const approved = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan: {
        ...buildPlan(),
        summary: 'Long-running approved plan',
      },
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(buildPlan()),
      sourceMessageId: 'msg-team-plan-approved-older',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    });

    updateTeamPlanApproval(approved.id, 'approved');

    for (let index = 0; index < 5; index += 1) {
      upsertTeamPlanTask(session.id, {
        kind: TEAM_PLAN_TASK_KIND,
        plan: {
          ...buildPlan(),
          summary: `Pending plan ${index + 1}`,
        },
        approvalStatus: 'pending',
        run: createTeamRunSkeleton(buildPlan()),
        sourceMessageId: `msg-team-plan-pending-${index + 1}`,
        approvedAt: null,
        rejectedAt: null,
        lastActionAt: null,
      });
    }

    const prompt = getMainAgentSessionTeamRuntimePrompt(session.id);

    expect(prompt).toContain('Task: Long-running approved plan');
    expect(prompt).toContain('Only mention these if the user explicitly asks what still needs approval');
  });
});
