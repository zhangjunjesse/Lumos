import { NextRequest, NextResponse } from 'next/server'
import { listAgents, upsertAgent, setEnabled, deleteAgent, agentExists, type StoredAgent } from '@/lib/mesh/mesh-agent-store'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'
import { ensureWorkshopExists } from '@/lib/mesh/mesh-workshop-store'

/** Agent Registry：团队信息设置页读写（按 workshopId=accountId 隔离）。GET 列表 / POST upsert|启停|新增 / DELETE。 */
function workshopOf(req: NextRequest): string {
  return req.nextUrl.searchParams.get('accountId') ?? DEFAULT_WORKSHOP_ID
}

export async function GET(req: NextRequest) {
  try {
    const workshopId = workshopOf(req)
    ensureWorkshopExists(workshopId)
    return NextResponse.json({ agents: listAgents(workshopId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: statusOf(error) })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const workshopId = typeof body.accountId === 'string' ? body.accountId : DEFAULT_WORKSHOP_ID
    if (typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }
    ensureWorkshopExists(workshopId)
    // 快捷启停
    if (body.action === 'setEnabled' && typeof body.enabled === 'boolean') {
      setEnabled(workshopId, body.id, body.enabled)
      return NextResponse.json({ agents: listAgents(workshopId) })
    }
    // 新增（含克隆）：id 在该工作室不能已存在，否则会静默覆盖既有 agent
    if (body.action === 'create' && agentExists(workshopId, body.id)) {
      return NextResponse.json({ error: `该工作室已有 agent：${body.id}` }, { status: 409 })
    }
    // 编辑/新增（role 仅新增时给；编辑不传则保留）
    const patch: Partial<StoredAgent> & { id: string } = { id: body.id }
    if (typeof body.role === 'string') patch.role = body.role as StoredAgent['role']
    if (typeof body.systemPrompt === 'string') patch.systemPrompt = body.systemPrompt
    if (typeof body.model === 'string') patch.model = body.model
    if (typeof body.interval === 'number') patch.interval = body.interval
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (Array.isArray(body.topics)) patch.topics = body.topics.map(String)
    if (Array.isArray(body.mcpAllowlist)) patch.mcpAllowlist = body.mcpAllowlist.map(String)
    if (body.workMode === 'active_loop' || body.workMode === 'event_driven') patch.workMode = body.workMode
    const agent = upsertAgent(workshopId, patch)
    return NextResponse.json({ agent, agents: listAgents(workshopId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: statusOf(error) })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (id === 'team.leader') return NextResponse.json({ error: '队长不可删（团队唯一）' }, { status: 400 })
    const workshopId = workshopOf(req)
    ensureWorkshopExists(workshopId)
    deleteAgent(workshopId, id)
    return NextResponse.json({ agents: listAgents(workshopId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: statusOf(error) })
  }
}

function statusOf(error: unknown): number {
  return error instanceof Error && error.message.startsWith('unknown mesh workshop:') ? 404 : 500
}
