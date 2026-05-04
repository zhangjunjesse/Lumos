import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  collectContextImages,
  getContextImageInjectionSkipReason,
} from '../context-image-injector'
import type { StageExecutionPayloadV1 } from '../runtime-contracts'

function buildPayload(tempDir: string, imagePath: string): StageExecutionPayloadV1 {
  const runWorkspace = path.join(tempDir, 'run')
  const stageWorkspace = path.join(runWorkspace, 'stages', 'target')
  const sourceOutputDir = path.join(runWorkspace, 'stages', 'source', 'output')
  const sharedReadDir = path.join(runWorkspace, 'shared')
  const artifactOutputDir = path.join(stageWorkspace, 'output')

  for (const dir of [stageWorkspace, sourceOutputDir, sharedReadDir, artifactOutputDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return {
    contractVersion: 'stage-execution-payload/v1',
    taskId: 'task-test',
    sessionId: 'session-test',
    runId: 'run-test',
    stageId: 'target',
    attempt: 1,
    workspace: {
      sessionWorkspace: tempDir,
      runWorkspace,
      stageWorkspace,
      sharedReadDir,
      artifactOutputDir,
    },
    agent: {
      agentDefinitionId: 'agent-test',
      agentType: 'workflow.worker',
      roleName: 'Worker',
      systemPrompt: 'Read the provided context and summarize it.',
      allowedTools: ['workspace.read'],
      capabilityTags: [],
      memoryPolicy: 'ephemeral-stage',
      outputSchema: 'stage-execution-result/v1',
      concurrencyLimit: 1,
    },
    taskContext: {
      userGoal: 'Analyze the upstream image.',
      summary: 'summary',
      expectedOutcome: 'outcome',
    },
    stage: {
      title: 'target',
      description: 'Analyze the upstream image.',
      acceptanceCriteria: ['done'],
      responseMode: 'plain-text',
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
        artifactKinds: [],
      },
    },
    dependencies: [{
      stageId: 'source',
      title: 'source',
      summary: `Image path: ${imagePath}`,
      artifactRefs: [imagePath],
    }],
    memoryRefs: {
      taskMemoryId: 'task-memory',
      plannerMemoryId: 'planner-memory',
      agentMemoryId: 'agent-memory',
    },
  }
}

describe('context-image-injector', () => {
  let tempDir: string
  let imagePath: string
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-image-injector-test-'))
    imagePath = path.join(tempDir, 'source.png')
    fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('injects upstream images for image analysis stages', () => {
    const payload = buildPayload(tempDir, imagePath)

    expect(getContextImageInjectionSkipReason(payload)).toBeNull()
    const images = collectContextImages(payload)

    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({
      filePath: imagePath,
      mediaType: 'image/png',
    })
    expect(images[0].base64).toBeTruthy()
  })

  test('skips raw multimodal injection for tool-driven image generation stages', () => {
    const payload = buildPayload(tempDir, imagePath)
    payload.agent.roleName = 'Scene Image Generator'
    payload.agent.systemPrompt = [
      'Create ecommerce scene images.',
      'Call mcp__lumos-image__generate_image with reference_image_paths.',
    ].join('\n')
    payload.stage.description = 'Generate 4 scene images for each direction.'

    expect(getContextImageInjectionSkipReason(payload)).toBe('tool-driven-scene-image-generation')
    expect(collectContextImages(payload)).toEqual([])
  })
})
