import { NextRequest, NextResponse } from 'next/server'
import { listAgents, upsertAgent, setEnabled, deleteAgent, type StoredAgent } from '@/lib/mesh/mesh-agent-store'

/** Agent Registry：团队信息设置页读写。GET 列表 / POST upsert|启停 / DELETE。 */
export async function GET() {
  try {
    return NextResponse.json({ agents: listAgents() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }
    // 快捷启停
    if (body.action === 'setEnabled' && typeof body.enabled === 'boolean') {
      setEnabled(body.id, body.enabled)
      return NextResponse.json({ agents: listAgents() })
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
    const agent = upsertAgent(patch)
    return NextResponse.json({ agent, agents: listAgents() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (id === 'team.leader') return NextResponse.json({ error: '队长不可删（团队唯一）' }, { status: 400 })
    deleteAgent(id)
    return NextResponse.json({ agents: listAgents() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
