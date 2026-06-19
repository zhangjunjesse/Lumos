import { NextRequest, NextResponse } from 'next/server'
import { getTeamConfig, upsertTeamConfig, type TeamConfig } from '@/lib/mesh/mesh-team-config'
import { getRiskRules, upsertRiskRules } from '@/lib/mesh/mesh-risk-store'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'
import type { RiskRules } from '@/lib/mesh/mesh-risk-rules'

/** 读某工作室团队配置 + 风控规则（设置页回显、状态条用，无 LLM）。GET ?accountId -> { config, risk } */
export async function GET(req: NextRequest) {
  try {
    const workshopId = req.nextUrl.searchParams.get('accountId') ?? DEFAULT_WORKSHOP_ID
    return NextResponse.json({ config: getTeamConfig(workshopId), risk: getRiskRules(workshopId) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to read config' },
      { status: 500 },
    )
  }
}

const RISK_NUM_KEYS = [
  'maxOrderNotional',
  'maxSymbolQty',
  'maxTotalNotional',
  'maxDailyLossAbs',
  'maxOrderCount',
  'maxDailyNotional',
] as const

/** 设置页保存（确定性写入，不经 LLM）。POST { accountId?, mode?, focus?, blacklist?, risk? } -> { config, risk } */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const workshopId = typeof body.accountId === 'string' ? body.accountId : DEFAULT_WORKSHOP_ID

    const patch: Partial<TeamConfig> = {}
    if (body.mode === 'auto' || body.mode === 'observe_only') patch.mode = body.mode
    if (typeof body.focus === 'string') patch.focus = body.focus
    if (Array.isArray(body.blacklist)) patch.blacklist = body.blacklist.map(String).filter(Boolean)
    const config = upsertTeamConfig(workshopId, patch)

    let risk = getRiskRules(workshopId)
    if (body.risk && typeof body.risk === 'object') {
      const r = body.risk as Record<string, unknown>
      const rp: Partial<RiskRules> = {}
      for (const k of RISK_NUM_KEYS) if (typeof r[k] === 'number') rp[k] = r[k] as number
      if (typeof r.noChaseLimitUp === 'boolean') rp.noChaseLimitUp = r.noChaseLimitUp
      risk = upsertRiskRules(workshopId, rp)
    }

    return NextResponse.json({ config, risk })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to save config' },
      { status: 500 },
    )
  }
}
