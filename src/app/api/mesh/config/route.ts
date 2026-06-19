import { NextRequest, NextResponse } from 'next/server'
import { getTeamConfig, upsertTeamConfig, type TeamConfig } from '@/lib/mesh/mesh-team-config'

/** 读团队配置（设置页回显、状态条用，无 LLM）。GET -> { config } */
export async function GET() {
  try {
    return NextResponse.json({ config: getTeamConfig() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to read team config' },
      { status: 500 },
    )
  }
}

/** 设置页保存团队配置（确定性写入，不经 LLM）。POST { mode?, focus?, blacklist? } -> { config } */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Partial<TeamConfig> = {}
    if (body.mode === 'auto' || body.mode === 'observe_only') patch.mode = body.mode
    if (typeof body.focus === 'string') patch.focus = body.focus
    if (Array.isArray(body.blacklist)) patch.blacklist = body.blacklist.map(String).filter(Boolean)
    const config = upsertTeamConfig(patch)
    return NextResponse.json({ config })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to save team config' },
      { status: 500 },
    )
  }
}
