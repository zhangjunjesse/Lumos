/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { createRun, getRun, getRunningRun, listRunningRuns, recordCycle, recordError, markStopped } from '../mesh-run'

describe('mesh-run DAO', () => {
  it('create → running，写定常驻 runId，getRunningRun 命中', () => {
    const r = createRun('a1', 2500, 'mrun_a1')
    expect(r.status).toBe('running')
    expect(r.intervalMs).toBe(2500)
    expect(r.rounds).toBe(0)
    expect(r.lastRunId).toBe('mrun_a1') // 常驻 session id 一开始就写定
    expect(getRunningRun('a1')?.id).toBe(r.id)
  })

  it('recordCycle 累加 rounds（lastRunId 在 createRun 写定，不变）', () => {
    const r = createRun('a2', 1000, 'mrun_a2')
    recordCycle(r.id)
    recordCycle(r.id)
    const got = getRun(r.id)!
    expect(got.rounds).toBe(2)
    expect(got.lastRunId).toBe('mrun_a2')
  })

  it('markStopped 终态，getRunningRun 不再命中', () => {
    const r = createRun('a3', 1000, 'mrun_a3')
    markStopped(r.id)
    expect(getRun(r.id)?.status).toBe('stopped')
    expect(getRun(r.id)?.stoppedAt).not.toBeNull()
    expect(getRunningRun('a3')).toBeNull()
  })

  it('listRunningRuns 只列 running', () => {
    const r1 = createRun('a4', 1000, 'mrun_a4')
    createRun('a5', 1000, 'mrun_a5')
    markStopped(r1.id)
    const running = listRunningRuns().map((x) => x.accountId)
    expect(running).toContain('a5')
    expect(running).not.toContain('a4')
  })

  it('recordError 写 lastError', () => {
    const r = createRun('a6', 1000, 'mrun_a6')
    recordError(r.id, 'boom')
    expect(getRun(r.id)?.lastError).toBe('boom')
  })
})
