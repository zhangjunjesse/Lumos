import { NextRequest, NextResponse } from 'next/server'
import { runStockCollaboration } from '@/lib/mesh/mesh-collaboration'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'
import { ensureWorkshopExists } from '@/lib/mesh/mesh-workshop-store'

/**
 * 跑一次炒股 mesh 协作（盯盘 → 异动 → 决策建议）。
 * POST { snapshot?, sessionId? } -> { runId, trace, decision }
 * 只读 + 只给建议，不下单、不碰真钱。行情用 snapshot 驱动（缺省给示例快照）。
 */
const DEFAULT_SNAPSHOT = {
  note: '示例行情快照（用于验协作编排）',
  ticks: [
    { code: '600160.SH', name: '巨化股份', last: 45.2, pct: 9.6, vol_surge: true, note: '放量快速拉升、逼近涨停' },
    { code: '600188.SH', name: '兖矿能源', last: 19.3, pct: -3.1, note: '破位下行' },
  ],
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const snapshot = body.snapshot ?? DEFAULT_SNAPSHOT
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
    const accountId = typeof body.accountId === 'string' ? body.accountId : DEFAULT_WORKSHOP_ID // 即 workshopId，缺省默认工作室
    ensureWorkshopExists(accountId)
    const result = await runStockCollaboration(snapshot, { sessionId, accountId })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'mesh collaboration failed' },
      { status: error instanceof Error && error.message.startsWith('unknown mesh workshop:') ? 404 : 500 },
    )
  }
}
