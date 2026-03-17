import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { StageExecutionPayloadV1 } from '../runtime-contracts'
import {
  buildStageRuntimeToolPolicy,
  createStageCanUseTool,
  getStageExecutionCwd,
} from '../runtime-tool-policy'

function buildPayload(
  tempDir: string,
  allowedTools: string[],
): StageExecutionPayloadV1 {
  const sessionWorkspace = path.join(tempDir, 'session')
  const runWorkspace = path.join(tempDir, 'run')
  const stageWorkspace = path.join(runWorkspace, 'stages', 'stage-1')
  const sharedReadDir = path.join(runWorkspace, 'shared')
  const artifactOutputDir = path.join(stageWorkspace, 'output')

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
      agentDefinitionId: 'agent-def:test-worker',
      agentType: 'worker.default',
      roleName: 'Test Worker',
      systemPrompt: 'You are a worker.',
      allowedTools: allowedTools as StageExecutionPayloadV1['agent']['allowedTools'],
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
        artifactKinds: ['file'],
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

describe('runtime-tool-policy', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-tool-policy-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('maps runtime capabilities to Claude tool names deterministically', () => {
    const payload = buildPayload(tempDir, [
      'workspace.read',
      'workspace.write',
      'shell.exec',
      'unknown.tool',
    ] as unknown as string[])

    expect(buildStageRuntimeToolPolicy(payload.agent)).toEqual({
      sdkTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Bash'],
      allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Bash'],
      unmappedCapabilities: ['unknown.tool'],
    })
  })

  test('uses the session workspace as the execution cwd when available', () => {
    const payload = buildPayload(tempDir, ['workspace.read'])
    expect(getStageExecutionCwd(payload)).toBe(payload.workspace.sessionWorkspace)
  })

  test('allows file reads inside the workspace but denies writes when the capability is missing', async () => {
    const payload = buildPayload(tempDir, ['workspace.read'])
    const canUseTool = createStageCanUseTool(payload)

    await expect(
      canUseTool(
        'Read',
        { file_path: path.join(payload.workspace.sessionWorkspace, 'src', 'index.ts') },
        { signal: new AbortController().signal, toolUseID: 'tool-1' },
      ),
    ).resolves.toMatchObject({ behavior: 'allow' })

    await expect(
      canUseTool(
        'Write',
        { file_path: path.join(payload.workspace.sessionWorkspace, 'src', 'index.ts'), content: 'x' },
        { signal: new AbortController().signal, toolUseID: 'tool-2' },
      ),
    ).resolves.toMatchObject({ behavior: 'deny' })
  })

  test('denies file writes outside the allowed workspace roots', async () => {
    const payload = buildPayload(tempDir, ['workspace.write'])
    const canUseTool = createStageCanUseTool(payload)

    await expect(
      canUseTool(
        'Write',
        { file_path: '/etc/passwd', content: 'nope' },
        { signal: new AbortController().signal, toolUseID: 'tool-3' },
      ),
    ).resolves.toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('outside allowed'),
    })
  })

  test('denies dangerous bash invocations even when shell execution is enabled', async () => {
    const payload = buildPayload(tempDir, ['shell.exec'])
    const canUseTool = createStageCanUseTool(payload)

    await expect(
      canUseTool(
        'Bash',
        { command: 'npm test' },
        { signal: new AbortController().signal, toolUseID: 'tool-4' },
      ),
    ).resolves.toMatchObject({ behavior: 'allow' })

    await expect(
      canUseTool(
        'Bash',
        { command: 'rm -rf /' },
        { signal: new AbortController().signal, toolUseID: 'tool-5' },
      ),
    ).resolves.toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('Dangerous command pattern'),
    })

    await expect(
      canUseTool(
        'Bash',
        { command: 'npm test', run_in_background: true },
        { signal: new AbortController().signal, toolUseID: 'tool-6' },
      ),
    ).resolves.toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('Background commands'),
    })
  })
})
