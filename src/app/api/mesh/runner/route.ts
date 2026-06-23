import { NextRequest, NextResponse } from 'next/server'
import {
  startMonitoring,
  stopMonitoring,
  monitoringStatus,
  DEFAULT_ACCOUNT_ID,
} from '@/lib/mesh/mesh-run-control'
import { emitMarketCloseNow } from '@/lib/mesh/mesh-runner'
import { isLiveBackendConfigured, liveBackend } from '@/lib/mesh/mesh-live-backend'
import { getTeamConfig } from '@/lib/mesh/mesh-team-config'
import { ensureWorkshopExists } from '@/lib/mesh/mesh-workshop-store'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = body.action
  const accountId = typeof body.accountId === 'string' ? body.accountId : DEFAULT_ACCOUNT_ID
  try {
    ensureWorkshopExists(accountId)
  } catch (error) {
    return NextResponse.json({ ok: false, reason: error instanceof Error ? error.message : 'unknown mesh workshop' }, { status: 404 })
  }

  if (action === 'start') {
    // 去假数据：默认不注入快照 → run-control 启真行情桥（qmt，按持仓取实时价）。
    // 仅当显式传 body.snapshot 才用固定值（调试/demo）。
    const result = startMonitoring({
      accountId,
      intervalMs: typeof body.intervalMs === 'number' ? body.intervalMs : undefined,
      ...(body.snapshot ? { snapshot: () => body.snapshot } : {}),
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  }

  if (action === 'stop') {
    const result = await stopMonitoring(accountId)
    const status = result.ok ? 200 : result.reason?.includes('超时') ? 409 : 404
    return NextResponse.json(result, { status })
  }

  if (action === 'emit_close') {
    const ok = emitMarketCloseNow(accountId) // 手动触发收盘复盘（演示/测试，无需等真 15:00）
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
  }

  return NextResponse.json({ ok: false, reason: `unknown action: ${String(action)}` }, { status: 400 })
}

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId') ?? DEFAULT_ACCOUNT_ID
  try {
    ensureWorkshopExists(accountId)
  } catch (error) {
    return NextResponse.json({ ok: false, reason: error instanceof Error ? error.message : 'unknown mesh workshop' }, { status: 404 })
  }
  // 真盘态按工作室真实计算(UI 开关 + 后端就绪),与 buildTradeContext 一致,不再读 env。
  const backendConfigured = isLiveBackendConfigured()
  const effLive = getTeamConfig(accountId).tradeMode === 'live' && backendConfigured
  return NextResponse.json({
    ...monitoringStatus(accountId),
    live: { liveEnabled: effLive, tradeMode: effLive ? 'live' : 'paper', backendConfigured, backendConnected: liveBackend().isConnected() },
  })
}
