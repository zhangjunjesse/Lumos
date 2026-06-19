import { NextRequest, NextResponse } from 'next/server'
import { isRunnerActive } from '@/lib/mesh/mesh-runner'
import { getLatestRun } from '@/lib/mesh/mesh-run'
import { getAccount } from '@/lib/mesh/mesh-paper-account'
import { readBlackboardHistory } from '@/lib/mesh/mesh-blackboard'
import { listAllMessages } from '@/lib/mesh/mesh-event-bus'
import { DEFAULT_ACCOUNT_ID } from '@/lib/mesh/mesh-run-control'

/**
 * 作战室快照（单工作室）：实时 + 最后一轮。
 * GET ?accountId -> { active, rounds, runId, account, blackboard, messages }
 * 薄 route，逻辑全复用已有函数。启停走 /api/mesh/runner。
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('accountId') ?? DEFAULT_ACCOUNT_ID
  const run = getLatestRun(accountId)
  const runId = run?.lastRunId ?? null
  return NextResponse.json({
    accountId,
    active: isRunnerActive(accountId),
    rounds: run?.rounds ?? 0,
    runId,
    account: getAccount(accountId),
    blackboard: runId ? readBlackboardHistory(runId) : [],
    messages: runId ? listAllMessages(runId) : [],
  })
}
