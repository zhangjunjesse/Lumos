/**
 * mesh-collab —— 通用多 agent 协作原语,做成 agent 在 turn 内可调的工具(in-process MCP)。
 *
 * 取代"agent 最后吐一份 action-plan、框架单事务执行"的旧模型:agent 像正常 Claude agent 一样
 * 边思考边调 read_blackboard/write_blackboard/emit_event/send_task/reply,读到结果能接着决策。
 * 这是框架的「① 通用协作工具」,与业务无关——任何团队(炒股/客服/调研)都用同一套。
 *
 * 每个 duty cycle 现建一次(带 runId/agentId/subscribersOf 上下文);工具调用即时产生副作用
 * (写黑板/投递消息),不再依赖 action-schema。
 */
import { randomUUID } from 'crypto'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { writeBlackboard, readBlackboard, readAllBlackboard } from './mesh-blackboard'
import { persistMessage, findTaskFrom } from './mesh-event-bus'
import { MESH_COLLAB_MCP_SERVER_NAME } from './mesh-constants'

export interface MeshCollabContext {
  runId: string
  /** 调用方 agent id(写黑板的作者 / 发消息的发件人)。 */
  agentId: string
  /** 某 topic 的订阅者(emit 时投递给他们);由 duty cycle 现读团队订阅关系传入。 */
  subscribersOf: (topic: string) => string[]
}

export function createMeshCollabMcpServer(ctx: MeshCollabContext) {
  return createSdkMcpServer({
    name: MESH_COLLAB_MCP_SERVER_NAME,
    tools: [
      tool(
        'read_blackboard',
        '读共享黑板。给 key 读单条;不给 key 读全部(返回 key+作者+值)。黑板是团队的共享记忆。',
        { key: z.string().optional().describe('要读的键;省略则读全部') },
        async (args): Promise<CallToolResult> => {
          if (args.key) {
            const e = readBlackboard(ctx.runId, args.key)
            return json(e ? { key: e.key, value: e.value, writtenBy: e.writtenBy } : null)
          }
          return json(readAllBlackboard(ctx.runId).map((e) => ({ key: e.key, value: e.value, writtenBy: e.writtenBy })))
        },
      ),
      tool(
        'write_blackboard',
        '写共享黑板(同 key 覆盖)。把你的结论/状态写进去,供团队其他 agent 读到。',
        { key: z.string().min(1), value: z.any().describe('任意 JSON 值') },
        async (args): Promise<CallToolResult> => {
          writeBlackboard(ctx.runId, args.key, args.value ?? null, ctx.agentId)
          return json({ ok: true })
        },
      ),
      tool(
        'emit_event',
        '广播一个事件到某 topic,订阅该 topic 的 agent 会被唤醒处理。topic 是任意字符串,由你的团队约定。',
        { topic: z.string().min(1), payload: z.any().describe('事件负载,任意 JSON') },
        async (args): Promise<CallToolResult> => {
          const subs = ctx.subscribersOf(args.topic).filter((s) => s !== ctx.agentId)
          persistMessage(ctx.runId, args.topic, args.payload ?? null, ctx.agentId, subs)
          return json({ ok: true, delivered_to: subs })
        },
      ),
      tool(
        'send_task',
        '定向派一个任务给某个具体 agent(点对点),对方会被唤醒处理并可 reply 回执。',
        { to: z.string().min(1).describe('目标 agent id'), summary: z.string().min(1).describe('任务内容') },
        async (args): Promise<CallToolResult> => {
          const taskId = `mtask_${randomUUID()}`
          persistMessage(ctx.runId, 'agent_task', { from: ctx.agentId, summary: args.summary }, ctx.agentId, [args.to], taskId)
          return json({ ok: true, task_id: taskId })
        },
      ),
      tool(
        'reply',
        '对收到的定向任务回执(带原 task_id),回给原派发者。',
        { task_id: z.string().min(1), summary: z.string().min(1).describe('回执内容') },
        async (args): Promise<CallToolResult> => {
          const to = findTaskFrom(ctx.runId, args.task_id)
          if (!to) return json({ ok: false, error: `找不到 task ${args.task_id} 的原派发者` })
          persistMessage(ctx.runId, 'agent_reply', { from: ctx.agentId, taskId: args.task_id, summary: args.summary }, ctx.agentId, [to], args.task_id)
          return json({ ok: true, replied_to: to })
        },
      ),
    ],
  })
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}
