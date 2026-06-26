/**
 * 网状 agent 执行器 —— 跑单个 mesh agent 一次。
 *
 * 独立于 workflow 执行器：从诞生就收敛 —— permissionMode:'default'（非 bypass）+ 真正
 * 传入 canUseTool + 只按 agent 白名单注入 MCP。只复用底层只读库（SDK 调用上下文、MCP 配置
 * 转换），不依赖也不修改 workflow 执行链。
 *
 * - runMeshAgent：收集纯文本（M1 单 agent 入口用）
 * - runMeshAgentText：跑一轮,agent 在 turn 内直接调注入的工具（mesh-collab 协作 / mesh-trade 下单）产生
 *   副作用,返回思考文本（常驻 duty cycle 主入口,取代旧的"结构化 action plan + 框架单事务执行"）
 * - runMeshAgentStructured：强制 JSON 输出（队长/管家等 NL→JSON 解析用,复用 runMeshAgentText）
 *
 * 设计依据：docs/agent-mesh-collaboration-design.md §5 / §6
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildClaudeSdkInvocationContext } from '@/lib/claude/sdk-runtime'
import { getProvider } from '@/lib/db/providers'
import { ensureClaudeLocalAuthReady } from '@/lib/claude/local-auth'
import { isClaudeLocalAuthProvider } from '@/lib/claude/provider-env'
import { createMeshCanUseTool, resolveMeshMcpServers, MESH_BUILTIN_TOOLS } from './mesh-tool-policy'
import { createMeshCollabMcpServer, MESH_COLLAB_MCP_SERVER_NAME, type MeshCollabContext } from './mesh-collab-mcp-server'
import { createMeshTradeMcpServer, MESH_TRADE_MCP_SERVER_NAME, type MeshTradeToolContext } from './mesh-trade-mcp-server'
import type { MeshAgentConfig } from './mesh-agent-config'
import type { McpServerStatus } from './mesh-mcp-status'

// 单轮 duty cycle 调模型上限:超时中止本轮并抛错(被调度器记进 mesh_run.last_error),
// 避免模型/代理一卡就静默死等、UI 假装"运行中"。
const MESH_QUERY_TIMEOUT_MS = 120_000

export interface MeshRunOptions {
  sessionId?: string
  abortController?: AbortController
  /** SDK 调用最大轮数；缺省 6。纯 NL→JSON 解析(队长/管家)可设低值,杜绝多轮工具探索拖到超时。 */
  maxTurns?: number
  /** 协作上下文:有则注入框架级 mesh-collab 工具(read/write_blackboard/emit_event/send_task/reply),
   *  让 agent 在 turn 内直接调协作原语(取代旧的 action-plan 输出)。缺省不注入(纯 NL/解析类如队长/管家)。 */
  collabContext?: MeshCollabContext
  /** 下单上下文:有且 agent.mcpAllowlist 含 'mesh-trade' 才注入 place_order 工具(经确定性风控总闸 + OrderGateway)。
   *  下单走 mcpAllowlist 正常裁决(不像 collab 那样人人放行)——能力隔离:只有声明下单职责的 agent 够得到。 */
  tradeContext?: MeshTradeToolContext
}

export interface MeshRunResult {
  text: string
  finishReason: 'completed' | 'aborted'
}

interface SdkStreamMessage {
  type?: string
  text?: string
  result?: unknown
  structured_output?: unknown
}

/** 从 SDK 的 system/init 消息里取 mcp_servers 状态（[{name,status}]）。 */
function extractMcpStatus(m: { type?: string; mcp_servers?: unknown }): McpServerStatus[] | undefined {
  if (m.type !== 'system' || !Array.isArray(m.mcp_servers)) return undefined
  return (m.mcp_servers as Array<{ name?: string; status?: string }>).map((s) => ({
    name: String(s.name ?? ''),
    status: String(s.status ?? ''),
  }))
}

/** 装配 mesh agent 的 SDK query options：非 bypass + 真 canUseTool + 白名单 MCP。 */
function prepareMeshQuery(agent: MeshAgentConfig, options: MeshRunOptions) {
  // agent 自选服务商优先;留空(undefined)时由 sdk-runtime 回落到会话/默认服务商。
  const provider = agent.providerId ? getProvider(agent.providerId) : undefined
  const ctx = buildClaudeSdkInvocationContext({ provider, sessionId: options.sessionId, requestedModel: agent.model })
  const mcpServers = resolveMeshMcpServers(agent.mcpAllowlist)
  // 框架级协作工具:有 collabContext 就注入 mesh-collab(read/write_blackboard/emit_event/send_task/reply),
  // 让 agent 在 turn 内直接调协作原语。它是框架自带、人人可用,不在 agent.mcpAllowlist 里(canUseTool 放行见 tool-policy)。
  const collabTools: string[] = []
  if (options.collabContext) {
    mcpServers[MESH_COLLAB_MCP_SERVER_NAME] = createMeshCollabMcpServer(options.collabContext)
    for (const t of ['read_blackboard', 'write_blackboard', 'emit_event', 'send_task', 'reply']) {
      collabTools.push(`mcp__${MESH_COLLAB_MCP_SERVER_NAME}__${t}`)
    }
  }
  // 框架级下单工具:有 tradeContext 且 agent 白名单声明了 'mesh-trade' 才注入 place_order。
  // 与 collab 不同它走 mcpAllowlist 正常裁决(canUseTool 据白名单放行)——能力隔离:只有有下单职责的 agent 够得到。
  const tradeTools: string[] = []
  if (options.tradeContext && agent.mcpAllowlist.includes(MESH_TRADE_MCP_SERVER_NAME)) {
    mcpServers[MESH_TRADE_MCP_SERVER_NAME] = createMeshTradeMcpServer(options.tradeContext)
    tradeTools.push(`mcp__${MESH_TRADE_MCP_SERVER_NAME}__place_order`)
  }
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
    allowedTools: [...MESH_BUILTIN_TOOLS, ...agent.toolAllowlist, ...collabTools, ...tradeTools],
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

/** 跑一个 mesh agent 一轮:agent 在 turn 内直接调注入的工具(mesh-collab 协作 / mesh-trade 下单)产生副作用,
 *  最后返回它的思考文本。带超时(MESH_QUERY_TIMEOUT_MS) + maxTurns 工具调用空间 + 本轮 MCP 连接状态 + local_auth 就绪。
 *  这是常驻 duty cycle 的主入口(取代旧的"结构化 action plan + 框架单事务执行")。 */
export async function runMeshAgentText(
  agent: MeshAgentConfig,
  prompt: string,
  options: MeshRunOptions = {},
): Promise<{ text: string; mcpStatus?: McpServerStatus[] }> {
  const { queryOptions, abortController, activeProvider } = prepareMeshQuery(agent, options)
  let text = ''
  let resultText = ''
  let mcpStatus: McpServerStatus[] | undefined
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
    // maxTurns:无工具时一轮即收口;有 MCP/协作工具的真 agent 留几轮工具调用空间(缺省 6);纯解析类可传低值防多轮拖超时。
    const stream = query({ prompt, options: { ...queryOptions, maxTurns: options.maxTurns ?? 6 } })
    for await (const message of stream) {
      const m = message as { type?: string; result?: unknown; text?: string; mcp_servers?: unknown; message?: { content?: Array<{ type?: string; text?: string }> } }
      mcpStatus = extractMcpStatus(m) ?? mcpStatus
      if (typeof m.text === 'string') text += m.text
      if (Array.isArray(m.message?.content)) {
        for (const c of m.message.content) if (c?.type === 'text' && typeof c.text === 'string') text += c.text
      }
      if (m.type === 'result' && typeof m.result === 'string') resultText = m.result
    }
    return { text: (resultText || text).trim(), mcpStatus }
  } catch (err) {
    if (timedOut) throw new Error(`mesh 调模型超时:${MESH_QUERY_TIMEOUT_MS / 1000}s 内无返回(已中止本轮)`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** 跑一个 mesh agent,要它输出严格 JSON(提示词约束 + 自己解析),返回解析后的结构 + 文本。
 *  不用 SDK 的 outputFormat:json_schema —— 对部分代理会陷入 assistant↔user 死循环、永不收口
 *  (chat 能用正是因为它纯文本流式)。改成像 chat 那样取文本,再从文本里抽 JSON。
 *  复用 runMeshAgentText 的流式/超时/mcpStatus/local_auth,只在前包 JSON Schema 指令、后抽 JSON。 */
export async function runMeshAgentStructured(
  agent: MeshAgentConfig,
  prompt: string,
  schema: Record<string, unknown>,
  options: MeshRunOptions = {},
): Promise<{ structured: unknown; text: string; mcpStatus?: McpServerStatus[] }> {
  const jsonPrompt = `${prompt}\n\n———\n只输出一个 JSON 对象,严格匹配下面的 JSON Schema;不要任何解释文字,不要用 markdown 代码块包裹:\n${JSON.stringify(schema)}`
  const { text, mcpStatus } = await runMeshAgentText(agent, jsonPrompt, options)
  return { structured: extractJson(text), text, mcpStatus }
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
