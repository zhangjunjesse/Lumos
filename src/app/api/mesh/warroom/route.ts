import { NextRequest, NextResponse } from 'next/server'
import { isRunnerActive } from '@/lib/mesh/mesh-runner'
import { getRunningRun, getLatestRun } from '@/lib/mesh/mesh-run'
import { getAccount } from '@/lib/mesh/mesh-paper-account'
import { readBlackboardHistory } from '@/lib/mesh/mesh-blackboard'
import { listAllMessages } from '@/lib/mesh/mesh-event-bus'
import { getTeamConfig } from '@/lib/mesh/mesh-team-config'
import { isLiveBackendConfigured } from '@/lib/mesh/mesh-live-backend'
import { DEFAULT_ACCOUNT_ID } from '@/lib/mesh/mesh-run-control'
import { ensureWorkshopExists } from '@/lib/mesh/mesh-workshop-store'

/**
 * 作战室快照（单工作室）：实时 + 最后一轮。
 * GET ?accountId -> { active, rounds, runId, account, blackboard, messages }
 * 薄 route，逻辑全复用已有函数。启停走 /api/mesh/runner。
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId') ?? DEFAULT_ACCOUNT_ID
  try {
    ensureWorkshopExists(accountId)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'unknown mesh workshop' }, { status: 404 })
  }
  const run = getRunningRun(accountId) ?? getLatestRun(accountId) // 优先正在跑的常驻 session（实时可见），停了回落最后一次
  const runId = run?.lastRunId ?? null
  const tradeMode = getTeamConfig(accountId).tradeMode === 'live' && isLiveBackendConfigured() ? 'live' : 'paper'
  return NextResponse.json({
    accountId,
    active: isRunnerActive(accountId),
    rounds: run?.rounds ?? 0,
    runId,
    tradeMode, // 真盘/模拟态:作战室据此显红色「真盘」徽标(重启后 live 恢复也可见)
    account: getAccount(accountId),
    blackboard: runId ? readBlackboardHistory(runId) : [],
    messages: runId ? listAllMessages(runId) : [],
  })
}
