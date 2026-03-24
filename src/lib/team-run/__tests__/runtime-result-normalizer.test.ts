import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { StageExecutionPayloadV1 } from '../runtime-contracts'
import {
  normalizeStageExecutionResult,
  parseStageExecutionModelOutput,
} from '../runtime-result-normalizer'

function buildPayload(tempDir: string): StageExecutionPayloadV1 {
  const outputDir = path.join(tempDir, 'output')
  fs.mkdirSync(outputDir, { recursive: true })

  return {
    contractVersion: 'stage-execution-payload/v1',
    taskId: 'task-test-001',
    sessionId: 'session-test-001',
    runId: 'run-test-001',
    stageId: 'stage-test-001',
    attempt: 1,
    workspace: {
      sessionWorkspace: tempDir,
      runWorkspace: tempDir,
      stageWorkspace: tempDir,
      sharedReadDir: tempDir,
      artifactOutputDir: outputDir,
    },
    agent: {
      agentDefinitionId: 'agent-def:test-worker',
      agentType: 'worker.default',
      roleName: 'Test Worker',
      systemPrompt: 'You are a worker.',
      allowedTools: ['workspace.read', 'workspace.write'],
      capabilityTags: ['execution'],
      memoryPolicy: 'ephemeral-stage',
      outputSchema: 'stage-execution-result/v1',
      concurrencyLimit: 1,
    },
    taskContext: {
      userGoal: 'goal',
      summary: 'summary',
      expectedOutcome: 'outcome',
    },
    stage: {
      title: 'Test Stage',
      description: 'Implement the stage',
      acceptanceCriteria: ['done'],
      inputContract: {
        requiredDependencyOutputs: [],
        taskContext: {
          includeUserGoal: true,
          includeExpectedOutcome: true,
          includeRunSummary: true,
        },
      },
      outputContract: {
        primaryFormat: 'markdown',
        mustProduceSummary: true,
        mayProduceArtifacts: true,
        artifactKinds: ['file', 'log', 'metadata', 'report'],
      },
    },
    dependencies: [],
    memoryRefs: {
      taskMemoryId: 'memory-task',
      plannerMemoryId: 'memory-planner',
      agentMemoryId: 'memory-agent',
    },
  }
}

describe('runtime-result-normalizer', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-result-normalizer-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('normalizes structured output and discovered artifacts into a stage result', () => {
    const payload = buildPayload(tempDir)
    fs.writeFileSync(path.join(payload.workspace.artifactOutputDir, 'report.md'), '# Report')
    fs.writeFileSync(path.join(payload.workspace.artifactOutputDir, 'debug.log'), 'debug')

    const result = normalizeStageExecutionResult({
      payload,
      modelOutput: parseStageExecutionModelOutput({
        outcome: 'done',
        summary: 'Stage completed.',
        detailArtifactPath: 'report.md',
        artifacts: [
          {
            kind: 'report',
            title: 'Stage report',
            relativePath: 'report.md',
          },
        ],
        memoryAppend: ['Done.'],
      }),
      startedAt: '2026-03-14T00:00:00.000Z',
      finishedAt: '2026-03-14T00:00:01.000Z',
      durationMs: 1000,
    })

    expect(result.outcome).toBe('done')
    expect(result.detailArtifactPath).toBe('report.md')
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        kind: 'report',
        title: 'Stage report',
        relativePath: 'report.md',
        contentType: 'text/markdown',
      }),
      expect.objectContaining({
        kind: 'file',
        title: 'debug.log',
        relativePath: 'debug.log',
        contentType: 'text/plain',
      }),
    ])
    expect(result.memoryAppend).toEqual([{ scope: 'agent', content: 'Done.' }])
  })

  test('rejects declared artifacts that do not exist on disk', () => {
    const payload = buildPayload(tempDir)

    expect(() => normalizeStageExecutionResult({
      payload,
      modelOutput: parseStageExecutionModelOutput({
        outcome: 'done',
        summary: 'Stage completed.',
        artifacts: [
          {
            kind: 'file',
            title: 'Missing artifact',
            relativePath: 'missing.txt',
          },
        ],
      }),
      startedAt: '2026-03-14T00:00:00.000Z',
      finishedAt: '2026-03-14T00:00:01.000Z',
      durationMs: 1000,
    })).toThrow('Declared artifact not found')
  })

  test('rejects successful results without a summary', () => {
    const payload = buildPayload(tempDir)

    expect(() => normalizeStageExecutionResult({
      payload,
      modelOutput: parseStageExecutionModelOutput({
        outcome: 'done',
        summary: '',
        artifacts: [],
      }),
      startedAt: '2026-03-14T00:00:00.000Z',
      finishedAt: '2026-03-14T00:00:01.000Z',
      durationMs: 1000,
    })).toThrow('non-empty summary')
  })

  test('fills a default error payload for failed results when the model omitted one', () => {
    const payload = buildPayload(tempDir)

    const result = normalizeStageExecutionResult({
      payload,
      modelOutput: parseStageExecutionModelOutput({
        outcome: 'failed',
        summary: '导出失败：缺少 PDF 引擎',
        artifacts: [],
      }),
      startedAt: '2026-03-14T00:00:00.000Z',
      finishedAt: '2026-03-14T00:00:01.000Z',
      durationMs: 1000,
    })

    expect(result.error).toEqual({
      code: 'stage_failed',
      message: '导出失败：缺少 PDF 引擎',
      retryable: true,
    })
  })
})
