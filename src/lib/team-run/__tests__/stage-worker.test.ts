import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { StageWorker } from '../stage-worker'
import type { StageExecutionPayloadV1 } from '../runtime-contracts'
import Database from 'better-sqlite3'
import { migrateTeamRunTables } from '../../db/migrations-team-run'

const mockQuery = jest.fn()
const mockBuildClaudeSdkRuntimeBootstrap = jest.fn(() => ({
  env: {
    ANTHROPIC_AUTH_TOKEN: 'runtime-secret',
  },
  settingSources: ['project'],
  pathToClaudeCodeExecutable: '/tmp/claude-agent-sdk/cli.js',
}))

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

jest.mock('@/lib/claude/sdk-runtime', () => ({
  buildClaudeSdkRuntimeBootstrap: () => mockBuildClaudeSdkRuntimeBootstrap(),
}))

function buildPayload(tempDir: string): StageExecutionPayloadV1 {
  const sessionWorkspace = path.join(tempDir, 'session')
  const runWorkspace = path.join(tempDir, 'run')
  const stageWorkspace = path.join(tempDir, 'stage')
  const sharedReadDir = path.join(tempDir, 'shared')
  const artifactOutputDir = path.join(tempDir, 'output')

  ;[sessionWorkspace, runWorkspace, stageWorkspace, sharedReadDir, artifactOutputDir].forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true })
  })

  return {
    contractVersion: 'stage-execution-payload/v1',
    taskId: 'task-test-001',
    sessionId: 'session-test-001',
    runId: 'run-test-001',
    stageId: 'stage-test-001',
    attempt: 1,
    workspace: {
      sessionWorkspace,
      runWorkspace,
      stageWorkspace,
      sharedReadDir,
      artifactOutputDir,
    },
    agent: {
      agentDefinitionId: 'worker.default:role-test-001',
      agentType: 'worker.default',
      roleName: 'Test Worker',
      systemPrompt: 'You are a worker.',
      allowedTools: ['workspace.read'],
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
      description: 'Echo hello',
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
        artifactKinds: ['file', 'report'],
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

async function* streamMessages(messages: any[]) {
  for (const message of messages) {
    yield message
  }
}

describe('StageWorker', () => {
  let db: Database.Database
  let worker: StageWorker
  let tempDir: string
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    db = new Database(':memory:')
    migrateTeamRunTables(db)

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-worker-test-'))
    worker = new StageWorker()
    mockQuery.mockReset()
    mockBuildClaudeSdkRuntimeBootstrap.mockClear()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    consoleErrorSpy.mockRestore()
    db.close()
  })

  describe('execute', () => {
    test('执行stage并返回结果', async () => {
      const payload = buildPayload(tempDir)

      const result = await worker.execute(payload)

      expect(result.stageId).toBe('stage-test-001')
      expect(result.outcome).toBe('done')
      expect(result.summary).toBeDefined()
      expect(result.contractVersion).toBe('stage-execution-result/v1')
    }, 30000)

    test('真实执行分支会消费 structured_output 并归一化 artifacts', async () => {
      const realWorker = new StageWorker(true)
      const payload = buildPayload(tempDir)

      fs.writeFileSync(path.join(payload.workspace.artifactOutputDir, 'report.md'), '# Report')
      fs.writeFileSync(path.join(payload.workspace.artifactOutputDir, 'notes.txt'), 'notes')

      mockQuery.mockReturnValue(streamMessages([
        {
          type: 'result',
          structured_output: {
            outcome: 'done',
            summary: 'Stage completed via SDK.',
            detailArtifactPath: 'report.md',
            artifacts: [
              {
                kind: 'report',
                title: 'Stage report',
                relativePath: 'report.md',
              },
            ],
            memoryAppend: ['Remember this output.'],
          },
        },
      ]))

      const result = await realWorker.execute(payload)

      expect(result).toMatchObject({
        contractVersion: 'stage-execution-result/v1',
        stageId: 'stage-test-001',
        outcome: 'done',
        summary: 'Stage completed via SDK.',
        detailArtifactPath: 'report.md',
        memoryAppend: [{ scope: 'agent', content: 'Remember this output.' }],
      })
      expect(result.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'report',
            title: 'Stage report',
            relativePath: 'report.md',
            contentType: 'text/markdown',
          }),
          expect.objectContaining({
            kind: 'file',
            title: 'notes.txt',
            relativePath: 'notes.txt',
            contentType: 'text/plain',
          }),
        ]),
      )

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0]).toMatchObject({
        options: {
          cwd: payload.workspace.sessionWorkspace,
          systemPrompt: 'You are a worker.',
          tools: ['Read', 'Glob', 'Grep'],
          allowedTools: ['Read', 'Glob', 'Grep'],
          permissionMode: 'dontAsk',
          env: {
            ANTHROPIC_AUTH_TOKEN: 'runtime-secret',
          },
          settingSources: ['project'],
          pathToClaudeCodeExecutable: '/tmp/claude-agent-sdk/cli.js',
          outputFormat: {
            type: 'json_schema',
          },
        },
      })
      expect(mockBuildClaudeSdkRuntimeBootstrap).toHaveBeenCalledTimes(1)
    })

    test('真实执行分支缺少 structured_output 时返回 failed 结果', async () => {
      const realWorker = new StageWorker(true)
      const payload = buildPayload(tempDir)

      mockQuery.mockReturnValue(streamMessages([
        {
          type: 'result',
          text: 'plain text only',
        },
      ]))

      const result = await realWorker.execute(payload)

      expect(result.outcome).toBe('failed')
      expect(result.error?.code).toBe('execution_failed')
      expect(result.error?.message).toBe('Task execution failed')
      expect(result.diagnostics).toMatchObject({
        rawMessage: 'Claude SDK did not return structured stage output',
        outputPreview: 'plain text only',
        roleName: 'Test Worker',
        agentType: 'worker.default',
        dependencyCount: 0,
      })
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[StageWorker] Execution error stage-test-001:'),
      )
    })
  })

  describe('getStatus', () => {
    test('返回worker状态', () => {
      const status = worker.getStatus()
      expect(status.state).toBe('idle')
    })
  })
})
