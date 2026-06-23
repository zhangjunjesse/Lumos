import { NextRequest, NextResponse } from 'next/server'
import { getTeamConfig, upsertTeamConfig, type TeamConfig } from '@/lib/mesh/mesh-team-config'
import { getRiskRules, upsertRiskRules } from '@/lib/mesh/mesh-risk-store'
import { DEFAULT_WORKSHOP_ID, LIVE_CONFIRM_WORD } from '@/lib/mesh/mesh-constants'
import { ensureWorkshopExists } from '@/lib/mesh/mesh-workshop-store'
import type { RiskRules } from '@/lib/mesh/mesh-risk-rules'

/** 读某工作室团队配置 + 风控规则（设置页回显、状态条用，无 LLM）。GET ?accountId -> { config, risk } */
export async function GET(req: NextRequest) {
  try {
    const workshopId = req.nextUrl.searchParams.get('accountId') ?? DEFAULT_WORKSHOP_ID
    ensureWorkshopExists(workshopId)
    return NextResponse.json({ config: getTeamConfig(workshopId), risk: getRiskRules(workshopId) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to read config' },
      { status: statusOf(error) },
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
    ensureWorkshopExists(workshopId)

    const patch: Partial<TeamConfig> = {}
    if (body.mode === 'auto' || body.mode === 'observe_only') patch.mode = body.mode
    if (typeof body.focus === 'string') patch.focus = body.focus
    if (Array.isArray(body.blacklist)) patch.blacklist = body.blacklist.map(String).filter(Boolean)
    if (Array.isArray(body.watchlist)) patch.watchlist = body.watchlist.map(String).filter(Boolean)
    // 真盘开关:关(paper)随时可;开(live)必须带确认词(真钱保险,挡误点/误调)。
    if (body.tradeMode === 'paper') patch.tradeMode = 'paper'
    else if (body.tradeMode === 'live') {
      // 仅 paper→live 切换要确认词(已 live 再存别的设置不重复要)。
      const alreadyLive = getTeamConfig(workshopId).tradeMode === 'live'
      if (!alreadyLive && body.liveConfirm !== LIVE_CONFIRM_WORD) {
        return NextResponse.json({ error: `开启真盘需确认：请输入「${LIVE_CONFIRM_WORD}」` }, { status: 400 })
      }
      patch.tradeMode = 'live'
    }
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
      { status: statusOf(error) },
    )
  }
}

function statusOf(error: unknown): number {
  return error instanceof Error && error.message.startsWith('unknown mesh workshop:') ? 404 : 500
}
