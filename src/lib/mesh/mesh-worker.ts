/**
 * 网状 agent 执行器 —— 跑单个 mesh agent 一次。
 *
 * 独立于 workflow 执行器：从诞生就收敛 —— permissionMode:'default'（非 bypass）+ 真正
 * 传入 canUseTool + 只按 agent 白名单注入 MCP。只复用底层只读库（SDK 调用上下文、MCP 配置
 * 转换），不依赖也不修改 workflow 执行链。
 *
 * - runMeshAgent：收集纯文本（M1 单 agent 入口用）
 * - runMeshActor：强制结构化 action plan（M3 协作用）
 *
 * 设计依据：docs/agent-mesh-collaboration-design.md §5 / §6
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildClaudeSdkInvocationContext } from '@/lib/claude/sdk-runtime'
import { createMeshCanUseTool, resolveMeshMcpServers } from './mesh-tool-policy'
import { buildMeshActionPlanSchema, parseActionPlan, type MeshActionPlan } from './mesh-action-schema'
import type { MeshAgentConfig } from './mesh-agent-config'

export interface MeshRunOptions {
  sessionId?: string
  abortController?: AbortController
}

export interface MeshRunResult {
  text: string
  finishReason: 'completed' | 'aborted'
}

export interface MeshActorResult {
  plan: MeshActionPlan
  text: string
}

interface SdkStreamMessage {
  type?: string
  text?: string
  result?: unknown
  structured_output?: unknown
}

/** 装配 mesh agent 的 SDK query options：非 bypass + 真 canUseTool + 白名单 MCP。 */
function prepareMeshQuery(agent: MeshAgentConfig, options: MeshRunOptions) {
  const ctx = buildClaudeSdkInvocationContext({ sessionId: options.sessionId, requestedModel: agent.model })
  const mcpServers = resolveMeshMcpServers(agent.mcpAllowlist)
  const abortController = options.abortController ?? new AbortController()
  const queryOptions = {
    abortController,
    systemPrompt: agent.systemPrompt,
    permissionMode: 'default' as const,
    canUseTool: createMeshCanUseTool(agent),
    env: ctx.env,
    settingSources: ctx.settingSources,
    ...(ctx.resolvedModel ? { model: ctx.resolvedModel } : {}),
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    ...(ctx.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: ctx.pathToClaudeCodeExecutable }
      : {}),
  }
  return { queryOptions, abortController }
}

/** 跑一个 mesh agent，收集纯文本。 */
export async function runMeshAgent(
  agent: MeshAgentConfig,
  prompt: string,
  options: MeshRunOptions = {},
): Promise<MeshRunResult> {
  const { queryOptions, abortController } = prepareMeshQuery(agent, options)
  let text = ''
  try {
    const stream = query({ prompt, options: queryOptions })
    for await (const message of stream) {
      const msg = message as SdkStreamMessage
      if (msg.text) text += msg.text
      if (msg.type === 'result' && typeof msg.result === 'string') text += msg.result
    }
    return { text, finishReason: 'completed' }
  } catch (err) {
    if (abortController.signal.aborted) {
      return { text, finishReason: 'aborted' }
    }
    throw err
  }
}

/** 跑一个 mesh agent，强制结构化输出，返回 SDK 的 structured_output 原值 + 文本。通用底座。 */
export async function runMeshAgentStructured(
  agent: MeshAgentConfig,
  prompt: string,
  schema: Record<string, unknown>,
  options: MeshRunOptions = {},
): Promise<{ structured: unknown; text: string }> {
  const { queryOptions } = prepareMeshQuery(agent, options)
  let structured: unknown
  let text = ''
  const stream = query({
    prompt,
    options: { ...queryOptions, outputFormat: { type: 'json_schema', schema } },
  })
  for await (const message of stream) {
    const msg = message as SdkStreamMessage
    if (msg.text) text += msg.text
    if (msg.type === 'result' && msg.structured_output) structured = msg.structured_output
  }
  return { structured, text }
}

/** 跑一个 mesh agent，强制返回结构化 action plan（协作用）。 */
export async function runMeshActor(
  agent: MeshAgentConfig,
  prompt: string,
  options: MeshRunOptions = {},
): Promise<MeshActorResult> {
  const { structured, text } = await runMeshAgentStructured(agent, prompt, buildMeshActionPlanSchema(), options)
  return { plan: parseActionPlan(structured), text }
}
