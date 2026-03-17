import { compileTeamPlanToRunPlan } from '../compiler'
import { createTeamRunSkeleton, type TeamPlan } from '@/types'

function buildPlan(): TeamPlan {
  return {
    version: 1,
    summary: 'Research Midscene',
    activationReason: 'user_requested',
    userGoal: 'Understand Midscene team workflow execution.',
    expectedOutcome: 'A concise report.',
    roles: [
      {
        id: 'main-agent',
        name: 'Main Agent',
        kind: 'main_agent',
        responsibility: 'User-facing control plane',
      },
      {
        id: 'researcher',
        name: 'Researcher',
        kind: 'worker',
        responsibility: 'Study the framework',
      },
    ],
    tasks: [
      {
        id: 'task-1',
        title: 'Inspect docs',
        ownerRoleId: 'researcher',
        summary: 'Read the public documentation.',
        dependsOn: [],
        expectedOutput: 'Notes',
      },
      {
        id: 'task-2',
        title: 'Summarize findings',
        ownerRoleId: 'researcher',
        summary: 'Summarize the important parts.',
        dependsOn: ['task-1'],
        expectedOutput: 'Summary',
      },
    ],
    risks: [],
  }
}

describe('compileTeamPlanToRunPlan', () => {
  test('uses run-scoped stage ids so repeated runs do not collide', () => {
    const plan = buildPlan()
    const run = createTeamRunSkeleton(plan)

    const first = compileTeamPlanToRunPlan({
      taskId: 'task-runtime-1',
      sessionId: 'session-1',
      runId: 'aaaaaaaa11111111bbbbbbbb22222222',
      workspaceRoot: '',
      plan,
      run,
    })

    const second = compileTeamPlanToRunPlan({
      taskId: 'task-runtime-1',
      sessionId: 'session-1',
      runId: 'cccccccc33333333dddddddd44444444',
      workspaceRoot: '',
      plan,
      run,
    })

    expect(first.stages.map((stage) => stage.stageId)).toEqual([
      'stage-1-aaaaaaaa-task-1',
      'stage-2-aaaaaaaa-task-2',
    ])
    expect(second.stages.map((stage) => stage.stageId)).toEqual([
      'stage-1-cccccccc-task-1',
      'stage-2-cccccccc-task-2',
    ])
    expect(new Set(first.stages.map((stage) => stage.stageId))).not.toEqual(
      new Set(second.stages.map((stage) => stage.stageId)),
    )
  })
})
