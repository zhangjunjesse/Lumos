import { createFinalSummaryResult } from '../final-summary'
import type { FinalSummaryPayloadV1 } from '../runtime-contracts'

function buildPayload(): FinalSummaryPayloadV1 {
  return {
    contractVersion: 'final-summary-payload/v1',
    taskId: 'task-test-001',
    sessionId: 'session-test-001',
    runId: 'run-test-001',
    userGoal: 'Ship the feature safely.',
    expectedOutcome: 'A working feature with tests and a rollout note.',
    runSummary: '- [done] Stage 1: implemented\n- [done] Stage 2: verified',
    stageResults: [
      {
        stageId: 'stage-1',
        title: 'Stage 1',
        status: 'done',
        summary: 'Implemented the main feature and saved the migration plan.',
        artifactRefs: ['artifact-1'],
      },
      {
        stageId: 'stage-2',
        title: 'Stage 2',
        status: 'done',
        summary: 'Added regression tests and verified the happy path.',
        artifactRefs: [],
      },
    ],
  }
}

describe('final-summary', () => {
  test('creates a deterministic final summary result from the payload', () => {
    const result = createFinalSummaryResult(buildPayload())

    expect(result).toMatchObject({
      contractVersion: 'final-summary-result/v1',
      runId: 'run-test-001',
      publishableMessage: result.finalSummary,
    })
    expect(result.keyOutputs).toEqual([
      'Stage 1: Implemented the main feature and saved the migration plan.',
      'Stage 2: Added regression tests and verified the happy path.',
    ])
    expect(result.finalSummary).toContain('# Final Summary')
    expect(result.finalSummary).toContain('## Run Overview')
    expect(result.finalSummary).toContain('## Key Outputs')
    expect(result.finalSummary).toContain('## Stage 1')
    expect(result.finalSummary).toContain('## Stage 2')
  })
})
