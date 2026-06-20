import { NextRequest, NextResponse } from 'next/server'
import { runMeshAgent } from '@/lib/mesh/mesh-worker'
import { getMeshAgent, STOCK_WATCH_AGENT } from '@/lib/mesh/mesh-stock-agents'

/**
 * 跑一个 mesh agent 一次（M1 最小运行入口）。
 * POST { agentId?, prompt?, sessionId? } -> { text, finishReason }
 *
 * 安全：只读盯盘 agent，下单类工具物理够不到（执行器按白名单硬拦截，见 mesh-tool-policy）。
 * 业务逻辑全在 lib/mesh，本 route 只做参数解析与响应。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const agentId = typeof body.agentId === 'string' ? body.agentId : STOCK_WATCH_AGENT.id
    const agent = getMeshAgent(agentId)
    if (!agent) {
      return NextResponse.json({ error: `unknown mesh agent: ${agentId}` }, { status: 400 })
    }

    const prompt =
      typeof body.prompt === 'string' && body.prompt.trim()
        ? body.prompt
        : '现在盯一下盘，看持仓风险和盘面异动。'
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined

    const result = await runMeshAgent(agent, prompt, { sessionId })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'mesh run failed' },
      { status: 500 },
    )
  }
}
