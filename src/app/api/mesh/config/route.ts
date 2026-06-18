import { NextResponse } from 'next/server'
import { getTeamConfig } from '@/lib/mesh/mesh-team-config'

/** 读团队配置（状态条用，无 LLM）。GET -> { config } */
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
