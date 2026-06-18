import { NextRequest, NextResponse } from 'next/server'
import {
  startMonitoring,
  stopMonitoring,
  monitoringStatus,
  DEFAULT_ACCOUNT_ID,
} from '@/lib/mesh/mesh-run-control'

/** M7 默认演示快照（不连真 qmt；可由请求体 snapshot 覆盖）。 */
const DEFAULT_SNAPSHOT = {
  ticks: [
    { code: '600160.SH', last: 45.2, pct: 5.1 },
    { code: '300750.SZ', last: 188.5, pct: -1.2 },
  ],
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = body.action
  const accountId = typeof body.accountId === 'string' ? body.accountId : DEFAULT_ACCOUNT_ID

  if (action === 'start') {
    const snapshot = body.snapshot ?? DEFAULT_SNAPSHOT
    const result = startMonitoring({
      accountId,
      intervalMs: typeof body.intervalMs === 'number' ? body.intervalMs : undefined,
      snapshot: () => snapshot,
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  }

  if (action === 'stop') {
    const result = stopMonitoring(accountId)
    return NextResponse.json(result, { status: result.ok ? 200 : 404 })
  }

  return NextResponse.json({ ok: false, reason: `unknown action: ${String(action)}` }, { status: 400 })
}

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId') ?? DEFAULT_ACCOUNT_ID
  return NextResponse.json(monitoringStatus(accountId))
}
