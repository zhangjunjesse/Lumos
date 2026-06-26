/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
// 把 SDK 的 createSdkMcpServer/tool 换成直通,直接拿到工具 handler 调用验副作用（也避免 jest 里加载 SDK ESM 炸）。
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (cfg: { name: string; tools: unknown[] }) => cfg,
  tool: (name: string, _desc: string, _schema: unknown, handler: unknown) => ({ name, handler }),
}))

import { createMeshCollabMcpServer, type MeshCollabContext } from '../mesh-collab-mcp-server'
import { readBlackboard } from '../mesh-blackboard'
import { listPendingDeliveries } from '../mesh-event-bus'

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

/** 拿到某 collab 工具的 handler（按工具名）。 */
function tools(ctx: MeshCollabContext): Record<string, Handler> {
  const server = createMeshCollabMcpServer(ctx) as unknown as { tools: Array<{ name: string; handler: Handler }> }
  return Object.fromEntries(server.tools.map((t) => [t.name, t.handler]))
}
async function call(handler: Handler, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await handler(args)
  return JSON.parse(res.content[0].text)
}

describe('mesh-collab —— 通用协作工具(in-process MCP)即时副作用', () => {
  it('write_blackboard / read_blackboard：写入即可读回(带作者)', async () => {
    const t = tools({ runId: 'rc1', agentId: 'a1', subscribersOf: () => [] })
    await call(t.write_blackboard, { key: 'obs', value: { code: '600519' } })
    expect(readBlackboard('rc1', 'obs')?.value).toEqual({ code: '600519' })
    expect(readBlackboard('rc1', 'obs')?.writtenBy).toBe('a1')
    const read = await call(t.read_blackboard, { key: 'obs' })
    expect(read).toEqual({ key: 'obs', value: { code: '600519' }, writtenBy: 'a1' })
  })

  it('emit_event：投递给订阅者(排除自己)', async () => {
    const subscribersOf = (topic: string) => (topic === 'quote_anomaly' ? ['observe', 'decide', 'risk'] : [])
    const t = tools({ runId: 'rc2', agentId: 'observe', subscribersOf })
    const out = await call(t.emit_event, { topic: 'quote_anomaly', payload: { code: '600160' } })
    expect((out.delivered_to as string[]).sort()).toEqual(['decide', 'risk']) // 排除自己 observe
    expect(listPendingDeliveries('rc2').map((p) => p.subscriberId).sort()).toEqual(['decide', 'risk'])
  })

  it('send_task → reply：定向派单产生 taskId，回执投回原派发者', async () => {
    const sent = await call(tools({ runId: 'rc3', agentId: 'decide', subscribersOf: () => [] }).send_task, { to: 'risk', summary: '审买入 600519' })
    expect(sent.ok).toBe(true)
    expect(typeof sent.task_id).toBe('string')
    expect(listPendingDeliveries('rc3').find((p) => p.subscriberId === 'risk' && p.taskId === sent.task_id)).toBeTruthy()
    // 风控对该任务回执 → 投回原派发者 decide
    const replied = await call(tools({ runId: 'rc3', agentId: 'risk', subscribersOf: () => [] }).reply, { task_id: sent.task_id, summary: '通过' })
    expect(replied).toEqual({ ok: true, replied_to: 'decide' })
    expect(listPendingDeliveries('rc3').find((p) => p.subscriberId === 'decide' && p.topic === 'agent_reply')).toBeTruthy()
  })

  it('reply 到不存在的 task：返回 ok:false 不抛', async () => {
    const r = await call(tools({ runId: 'rc4', agentId: 'x', subscribersOf: () => [] }).reply, { task_id: 'nope', summary: 'x' })
    expect(r.ok).toBe(false)
  })
})
