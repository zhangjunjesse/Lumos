import { NextRequest, NextResponse } from 'next/server'
import { listWorkshops, getWorkshop, createWorkshop, updateWorkshop } from '@/lib/mesh/mesh-workshop-store'
import { ensureSeed } from '@/lib/mesh/mesh-agent-store'
import { deleteWorkshop } from '@/lib/mesh/mesh-workshop-lifecycle'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'

/**
 * 工作室 CRUD。GET 列表 / POST 新建（+ seed 一套默认团队）/ PATCH 改名描述。
 * 删除在 /workshops DELETE（W5 级联 lifecycle：停 runner + 删配置/历史）。薄 route，逻辑在 lib/mesh。
 */
export async function GET() {
  try {
    return NextResponse.json({ workshops: listWorkshops() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const workshop = createWorkshop({ name, description: typeof body.description === 'string' ? body.description : '' })
    ensureSeed(workshop.id) // 新工作室落一套默认 5 agents（队长 + 盯盘/决策/风控/复盘）
    return NextResponse.json({ workshop, workshops: listWorkshops() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const patch: { name?: string; description?: string; status?: 'active' | 'paused' | 'draft' } = {}
    if (typeof body.name === 'string') patch.name = body.name
    if (typeof body.description === 'string') patch.description = body.description
    if (body.status === 'active' || body.status === 'paused' || body.status === 'draft') patch.status = body.status
    updateWorkshop(body.id, patch)
    return NextResponse.json({ workshop: getWorkshop(body.id), workshops: listWorkshops() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (id === DEFAULT_WORKSHOP_ID) return NextResponse.json({ error: '默认工作室不可删' }, { status: 400 })
    deleteWorkshop(id) // 全删干净：停 runner + 级联删配置/历史
    return NextResponse.json({ workshops: listWorkshops() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
