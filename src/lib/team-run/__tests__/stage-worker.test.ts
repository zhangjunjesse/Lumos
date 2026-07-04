import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { StageWorker } from '../stage-worker'
import type { StageExecutionPayloadV1 } from '../runtime-contracts'

const mockQuery = jest.fn()
const mockBuildClaudeSdkRuntimeBootstrap = jest.fn((options?: { provider?: unknown; requestedModel?: string }) => ({
  env: {
    ANTHROPIC_AUTH_TOKEN: 'runtime-secret',
  },
  settingSources: ['project'],
  pathToClaudeCodeExecutable: '/tmp/claude-agent-sdk/cli.js',
  activeProvider: options?.provider,
  requestedModel: options?.requestedModel,
  resolvedModel: options?.requestedModel === 'doubao-seed-2.0-lite' || options?.requestedModel === 'claude-sonnet-4-6'
    ? 'doubao-seed-2-0-lite-260215'
    : options?.requestedModel,
}))

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}))

jest.mock('@/lib/claude/local-auth', () => ({
  ensureClaudeLocalAuthReady: jest.fn(async () => undefined),
}))

jest.mock('@/lib/claude/sdk-runtime', () => ({
  buildClaudeSdkRuntimeBootstrap: (...args: unknown[]) => mockBuildClaudeSdkRuntimeBootstrap(...args),
  buildClaudeSdkInvocationContext: (...args: unknown[]) => mockBuildClaudeSdkRuntimeBootstrap(...args),
}))

jest.mock('@/lib/mcp-resolver', () => ({
  resolveEnabledMcpServers: jest.fn(() => undefined),
  toSdkMcpConfig: jest.fn(() => undefined),
}))

// Mocked to cut the heavy transitive chain (agent-capabilities → connectors →
// wechat-mcp → scheduler → openworkflow) that Jest's Haste map can't resolve.
// The real buildDbServerHints has its own coverage in registry.test.ts; here we
// only assert stage-worker actually feeds its output into the agent prompt.
const mockBuildDbServerHints = jest.fn(() => '')
jest.mock('@/lib/agent-capabilities', () => ({
  buildDbServerHints: (...args: unknown[]) => mockBuildDbServerHints(...args),
}))

jest.mock('@/lib/knowledge/workflow-knowledge-tool', () => ({
  createKnowledgeMcpServer: jest.fn(() => ({})),
}))

jest.mock('@/lib/knowledge/workflow-prompt-section', () => ({
  buildKnowledgePromptSection: jest.fn(() => ''),
  KNOWLEDGE_MCP_SERVER_NAME: 'knowledge',
}))

jest.mock('@/lib/knowledge/tag-resolver', () => ({
  resolveTagNames: jest.fn(() => ({ tags: [], missing: [] })),
  listTagCatalog: jest.fn(() => []),
}))

jest.mock('@/lib/claude/builtin-agent-context', () => ({
  buildBuiltinAgentContext: jest.fn(() => ({
    inProcessMcpServers: undefined,
    systemPromptSuffix: undefined,
  })),
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
    requestedModel: 'claude-sonnet-4-6',
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
      agentMemoryId: 'memory-agent',
    },
  }
}

async function* streamMessages(messages: unknown[]) {
  for (const message of messages) {
    yield message
  }
}

describe('StageWorker', () => {
  let worker: StageWorker
  let tempDir: string
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-worker-test-'))
    worker = new StageWorker()
    mockQuery.mockReset()
    mockBuildClaudeSdkRuntimeBootstrap.mockClear()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    consoleErrorSpy.mockRestore()
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

    test('依赖提示不再伪造 shared summary 文件路径', () => {
      const payload = buildPayload(tempDir)
      payload.dependencies = [
        {
          stageId: 'analyzeResult',
          title: 'analyzeResult',
          summary: 'parsed summary text',
          artifactRefs: [],
        },
      ]

      const prompt = (worker as unknown as { buildPrompt: (p: StageExecutionPayloadV1) => string }).buildPrompt(payload)

      expect(prompt).toContain('parsed summary text')
      expect(prompt).not.toContain('Summary file:')
      expect(prompt).toContain('不要自行猜测 shared 目录中的 summary 文件名')
    })

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
          permissionMode: 'bypassPermissions',
          model: 'doubao-seed-2-0-lite-260215',
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
      expect(mockBuildClaudeSdkRuntimeBootstrap).toHaveBeenCalledWith({
        provider: undefined,
        sessionId: 'session-test-001',
        requestedModel: 'claude-sonnet-4-6',
        requestMetadata: {
          module: 'workflow',
          operation: 'stage-worker',
          sessionId: 'session-test-001',
          runId: 'run-test-001',
          stageId: 'stage-test-001',
        },
      })
    })

    test('workflow agent 的 systemPrompt 带上能力注册中心的 DB 工具说明（S3 接入）', async () => {
      const realWorker = new StageWorker(true)
      const payload = buildPayload(tempDir)
      mockBuildDbServerHints.mockReturnValueOnce('<<DEEPSEARCH+FEISHU 用法说明>>')

      mockQuery.mockReturnValue(streamMessages([
        {
          type: 'result',
          structured_output: { outcome: 'done', summary: 'ok', artifacts: [] },
        },
      ]))

      await realWorker.execute(payload)

      expect(mockBuildDbServerHints).toHaveBeenCalled()
      const systemPrompt = mockQuery.mock.calls[0][0]?.options?.systemPrompt as string
      expect(systemPrompt).toContain('You are a worker.')
      expect(systemPrompt).toContain('<<DEEPSEARCH+FEISHU 用法说明>>')
    })

    test('真实执行分支会把 Claude 风格请求模型映射到 provider catalog 实际模型', async () => {
      const realWorker = new StageWorker(true)
      const payload = buildPayload(tempDir)

      mockQuery.mockReturnValue(streamMessages([
        {
          type: 'result',
          structured_output: {
            outcome: 'done',
            summary: 'Stage completed via SDK.',
            artifacts: [],
          },
        },
      ]))

      await realWorker.execute(payload, {
        provider: {
          id: 'provider-lumos-cloud',
          name: 'Lumos Cloud',
          provider_type: 'anthropic',
          api_protocol: 'anthropic-messages',
          capabilities: '["agent-chat"]',
          provider_origin: 'system',
          auth_mode: 'api_key',
          base_url: 'http://api.miki.zj.cn',
          api_key: 'sk-test',
          is_active: 1,
          sort_order: 0,
          extra_env: '{}',
          model_catalog: JSON.stringify([
            { value: 'doubao-seed-2-0-lite-260215', label: 'doubao-seed-2-0-lite-260215' },
          ]),
          model_catalog_source: 'default',
          model_catalog_updated_at: null,
          notes: '',
          is_builtin: 1,
          user_modified: 0,
          created_at: '2026-04-10 00:00:00',
          updated_at: '2026-04-10 00:00:00',
        },
      })

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0]?.options?.model).toBe('doubao-seed-2-0-lite-260215')
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

    test('structured_output 多次失败时会返回失败诊断', async () => {
      const realWorker = new StageWorker(true)
      const payload = buildPayload(tempDir)
      payload.stage.outputContract = {
        primaryFormat: 'markdown',
        mustProduceSummary: true,
        mayProduceArtifacts: false,
        artifactKinds: [],
      }

      mockQuery.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          throw new Error('Claude Code returned an error result: Failed to provide valid structured output after 5 attempts')
        },
      })

      const result = await realWorker.execute(payload)

      expect(result).toMatchObject({
        outcome: 'failed',
        summary: '',
        artifacts: [],
        diagnostics: {
          errorName: 'Error',
          rawMessage: 'Claude Code returned an error result: Failed to provide valid structured output after 5 attempts',
        },
      })
      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0]).toMatchObject({
        options: {
          outputFormat: {
            type: 'json_schema',
          },
        },
      })
    })

    test('真实执行分支遇到 token 额度耗尽时不重试并返回终止错误', async () => {
      const realWorker = new StageWorker(true)
      const payload = buildPayload(tempDir)

      mockQuery.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          throw new Error('429 Too Many Requests: 该令牌额度已用尽 TokenStatusExhausted[sk-O3G***wxK]')
        },
      })

      const result = await realWorker.execute(payload)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        outcome: 'failed',
        error: {
          code: 'llm_quota_exhausted',
          retryable: false,
        },
      })
      expect(result.error?.message).toContain('余额或令牌额度已耗尽')
    })

    test('纯文本交付模式会直接请求正文文本而不要求 structured_output', async () => {
      const realWorker = new StageWorker(true)
      const payload = buildPayload(tempDir)
      payload.stage.responseMode = 'plain-text'
      payload.stage.outputContract = {
        primaryFormat: 'markdown',
        mustProduceSummary: true,
        mayProduceArtifacts: false,
        artifactKinds: [],
      }

      mockQuery.mockReturnValue(streamMessages([
        {
          type: 'result',
          result: '# Claude 使用技巧报告\n\n- 先写清目标\n- 控制上下文\n- 善用迭代',
        },
      ]))

      const result = await realWorker.execute(payload)

      expect(result).toMatchObject({
        outcome: 'done',
        summary: '# Claude 使用技巧报告\n\n- 先写清目标\n- 控制上下文\n- 善用迭代',
        artifacts: [],
        diagnostics: {
          errorName: 'PlainTextDeliveryMode',
          rawMessage: expect.stringContaining('Runtime requested plain-text stage delivery'),
        },
      })
      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0].prompt).toContain('Plain-Text Delivery Mode')
      expect(mockQuery.mock.calls[0][0].options.outputFormat).toBeUndefined()
    })

    test('cancel 会中断真实执行分支并返回 cancelled 结果', async () => {
      const realWorker = new StageWorker(true)
      const payload = buildPayload(tempDir)
      let observedAbortController: AbortController | undefined

      mockQuery.mockImplementation(({ options }: { options: { abortController?: AbortController } }) => {
        observedAbortController = options.abortController

        return (async function* () {
          await new Promise<never>((_, reject) => {
            const abortWithError = () => {
              const error = new Error('Operation aborted') as Error & { code?: string }
              error.name = 'AbortError'
              error.code = 'ABORT_ERR'
              reject(error)
            }

            if (!options.abortController) {
              reject(new Error('abortController was not provided to Claude SDK'))
              return
            }

            if (options.abortController.signal.aborted) {
              abortWithError()
              return
            }

            options.abortController.signal.addEventListener('abort', abortWithError, { once: true })
          })
        })()
      })

      const resultPromise = realWorker.execute(payload)
      await new Promise((resolve) => setTimeout(resolve, 0))
      await realWorker.cancel()
      const result = await resultPromise

      expect(observedAbortController?.signal.aborted).toBe(true)
      expect(result).toMatchObject({
        outcome: 'failed',
        error: {
          code: 'execution_cancelled',
          message: 'Task execution cancelled',
          retryable: false,
        },
      })
      expect(consoleErrorSpy).not.toHaveBeenCalled()
      expect(realWorker.getStatus().state).toBe('cancelled')
    })
  })

  describe('getStatus', () => {
    test('返回worker状态', () => {
      const status = worker.getStatus()
      expect(status.state).toBe('idle')
    })
  })
})
