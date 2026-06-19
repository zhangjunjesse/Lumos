/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
// mock runner：隔离 control 的生命周期逻辑，不真起时间轮（保留 tick 常量供 startMonitoring 算下限）
jest.mock('../mesh-runner', () => ({
  startRunner: jest.fn(),
  stopRunner: jest.fn(),
  isRunnerActive: jest.fn(),
  getActiveRunner: jest.fn(),
  MIN_TICK_MS: 1000,
  DEFAULT_TICK_MS: 2500,
}))

import { startMonitoring, stopMonitoring, reconcileOrphans } from '../mesh-run-control'
import { startRunner, stopRunner, isRunnerActive, getActiveRunner } from '../mesh-runner'
import { createRun, getRun } from '../mesh-run'
import { listParticipants } from '../mesh-participant-store'

const mStart = jest.mocked(startRunner)
const mStop = jest.mocked(stopRunner)
const mActive = jest.mocked(isRunnerActive)
const mGet = jest.mocked(getActiveRunner)

beforeEach(() => {
  mStart.mockReset()
  mStop.mockReset()
  mActive.mockReset().mockReturnValue(false)
  mGet.mockReset().mockReturnValue(undefined)
})

describe('mesh-run-control 生命周期', () => {
  it('start：未在跑 → 建 mesh_run(running，写定 runId) + initParticipants + 启 runner', () => {
    const r = startMonitoring({ accountId: 'c1', intervalMs: 5000, snapshot: () => ({}) })
    expect(r.ok).toBe(true)
    expect(r.run?.accountId).toBe('c1')
    expect(getRun(r.run!.id)?.status).toBe('running')
    expect(getRun(r.run!.id)?.lastRunId).toMatch(/^mrun_/) // 常驻 runId 写定
    expect(listParticipants(r.run!.lastRunId!).length).toBeGreaterThan(0) // 建了 participant 行
    expect(mStart).toHaveBeenCalledTimes(1)
  })

  it('start：已在跑 → 拒，不重复起 runner', () => {
    mActive.mockReturnValue(true)
    const r = startMonitoring({ accountId: 'c2', snapshot: () => ({}) })
    expect(r.ok).toBe(false)
    expect(mStart).not.toHaveBeenCalled()
  })

  it('tickMs 下限保护（太小拉到 MIN_TICK_MS）', () => {
    startMonitoring({ accountId: 'c3', intervalMs: 100, snapshot: () => ({}) })
    expect(mStart).toHaveBeenCalledWith(expect.objectContaining({ tickMs: 1000 }))
  })

  it('stop：有活跃 runner → 调 stopRunner', () => {
    mStop.mockReturnValue(true)
    const r = stopMonitoring('c4')
    expect(r.ok).toBe(true)
    expect(mStop).toHaveBeenCalledWith('c4')
  })

  it('stop：内存无 runner 但有孤儿 mesh_run → 清孤儿标 stopped', () => {
    mStop.mockReturnValue(false)
    const run = createRun('c5', 1000, 'mrun_c5')
    const r = stopMonitoring('c5')
    expect(r.ok).toBe(true)
    expect(getRun(run.id)?.status).toBe('stopped')
  })

  it('stop：既无 runner 也无记录 → ok=false', () => {
    mStop.mockReturnValue(false)
    const r = stopMonitoring('c-none')
    expect(r.ok).toBe(false)
  })

  it('reconcileOrphans：running 但内存无 runner → 标 stopped', () => {
    const run = createRun('c6', 1000, 'mrun_c6')
    const cleared = reconcileOrphans()
    expect(cleared).toBeGreaterThanOrEqual(1)
    expect(getRun(run.id)?.status).toBe('stopped')
  })
})
