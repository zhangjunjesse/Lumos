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
import { getProvider } from '@/lib/db/providers'
import { ensureClaudeLocalAuthReady } from '@/lib/claude/local-auth'
import { isClaudeLocalAuthProvider } from '@/lib/claude/provider-env'
import { createMeshCanUseTool, resolveMeshMcpServers, MESH_BUILTIN_TOOLS } from './mesh-tool-policy'
import { buildMeshActionPlanSchema, parseActionPlan, type MeshActionPlan } from './mesh-action-schema'
import type { MeshAgentConfig } from './mesh-agent-config'

// 单轮 duty cycle 调模型上限:超时中止本轮并抛错(被调度器记进 mesh_run.last_error),
// 避免模型/代理一卡就静默死等、UI 假装"运行中"。
const MESH_QUERY_TIMEOUT_MS = 120_000

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
  // agent 自选服务商优先;留空(undefined)时由 sdk-runtime 回落到会话/默认服务商。
  const provider = agent.providerId ? getProvider(agent.providerId) : undefined
  const ctx = buildClaudeSdkInvocationContext({ provider, sessionId: options.sessionId, requestedModel: agent.model })
  const mcpServers = resolveMeshMcpServers(agent.mcpAllowlist)
  // 本轮独立 controller:外部 abort(停团队)联动它,但本轮超时只 abort 它、不波及整个 run。
  const abortController = new AbortController()
  const external = options.abortController
  if (external) {
    if (external.signal.aborted) abortController.abort()
    else external.signal.addEventListener('abort', () => abortController.abort(), { once: true })
  }
  const queryOptions = {
    abortController,
    systemPrompt: agent.systemPrompt,
    permissionMode: 'default' as const,
    // 全放开:预批准全部内置工具(+ agent 额外声明的),让 agent 确知可用、不再误判"没工具"。
    // canUseTool 仍兜底裁决(内置放行、未注入 MCP 拒);下单安全靠 OrderGateway 结构隔离。
    allowedTools: [...MESH_BUILTIN_TOOLS, ...agent.toolAllowlist],
    canUseTool: createMeshCanUseTool(agent),
    env: ctx.env,
    settingSources: ctx.settingSources,
    ...(ctx.resolvedModel ? { model: ctx.resolvedModel } : {}),
    ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    ...(ctx.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: ctx.pathToClaudeCodeExecutable }
      : {}),
  }
  return { queryOptions, abortController, activeProvider: ctx.activeProvider }
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

/** 跑一个 mesh agent,要它输出严格 JSON(提示词约束 + 自己解析),返回解析后的结构 + 文本。
 *  不用 SDK 的 outputFormat:json_schema —— 对部分代理会陷入 assistant↔user 死循环、永不收口
 *  (chat 能用正是因为它纯文本流式)。改成像 chat 那样取文本,再从文本里抽 JSON。 */
export async function runMeshAgentStructured(
  agent: MeshAgentConfig,
  prompt: string,
  schema: Record<string, unknown>,
  options: MeshRunOptions = {},
): Promise<{ structured: unknown; text: string }> {
  const { queryOptions, abortController, activeProvider } = prepareMeshQuery(agent, options)
  const jsonPrompt = `${prompt}\n\n———\n只输出一个 JSON 对象,严格匹配下面的 JSON Schema;不要任何解释文字,不要用 markdown 代码块包裹:\n${JSON.stringify(schema)}`
  let text = ''
  let resultText = ''
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, MESH_QUERY_TIMEOUT_MS)
  try {
    // 关键:本地登录(local_auth)服务商必须先把登录态准备好,否则隔离环境里没凭据 → 401。chat 也是这么做的。
    if (isClaudeLocalAuthProvider(activeProvider)) {
      await ensureClaudeLocalAuthReady(activeProvider)
    }
    // maxTurns 兜底:无工具时一轮即出 JSON;有 MCP 的真 agent 留几轮工具调用空间,同时防跑飞。
    const stream = query({ prompt: jsonPrompt, options: { ...queryOptions, maxTurns: 6 } })
    for await (const message of stream) {
      const m = message as { type?: string; result?: unknown; text?: string; message?: { content?: Array<{ type?: string; text?: string }> } }
      if (typeof m.text === 'string') text += m.text
      if (Array.isArray(m.message?.content)) {
        for (const c of m.message.content) if (c?.type === 'text' && typeof c.text === 'string') text += c.text
      }
      if (m.type === 'result' && typeof m.result === 'string') resultText = m.result
    }
    const finalText = (resultText || text).trim()
    return { structured: extractJson(finalText), text: finalText }
  } catch (err) {
    if (timedOut) throw new Error(`mesh 调模型超时:${MESH_QUERY_TIMEOUT_MS / 1000}s 内无返回(已中止本轮)`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** 从模型文本里抽出 JSON 对象:容忍 ```json 围栏和前后多余文字。 */
function extractJson(text: string): unknown {
  if (!text) return undefined
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  try {
    return JSON.parse(body)
  } catch {
    /* 再试:截首个 { 到末个 } */
  }
  const s = body.indexOf('{')
  const e = body.lastIndexOf('}')
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(body.slice(s, e + 1))
    } catch {
      /* 解析不出就返回 undefined,由上层降级 */
    }
  }
  return undefined
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
