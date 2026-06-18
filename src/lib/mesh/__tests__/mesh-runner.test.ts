/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
jest.mock('../mesh-collaboration', () => ({ runStockCollaboration: jest.fn() }))

import { runStockCollaboration } from '../mesh-collaboration'
import { startRunner, stopRunner, getActiveRunner, isRunnerActive, activeAccountIds } from '../mesh-runner'
import { createRun, getRun } from '../mesh-run'

const mockedCollab = jest.mocked(runStockCollaboration)
const result = (runId: string) => ({ runId, trace: [], decision: null, account: null })

beforeEach(() => {
  jest.useFakeTimers()
  mockedCollab.mockReset()
})
afterEach(() => {
  for (const id of activeAccountIds()) stopRunner(id) // 清残留 runner，避免污染下个用例
  jest.useRealTimers()
})

describe('mesh-runner 常驻循环', () => {
  it('启动按 setTimeout 链跑多轮，透传 accountId，记 rounds', async () => {
    let n = 0
    mockedCollab.mockImplementation(async () => result('r' + ++n))
    const run = createRun('acc-multi', 1000)
    startRunner({ controlId: run.id, accountId: 'acc-multi', intervalMs: 1000, snapshot: () => ({ ticks: [] }) })

    await jest.advanceTimersByTimeAsync(0) // flush 第一轮（立即触发）
    expect(getActiveRunner('acc-multi')?.rounds).toBe(1)
    await jest.advanceTimersByTimeAsync(1000) // 第二轮
    expect(getActiveRunner('acc-multi')?.rounds).toBe(2)
    await jest.advanceTimersByTimeAsync(1000) // 第三轮
    expect(getActiveRunner('acc-multi')?.rounds).toBe(3)

    expect(mockedCollab).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acc-multi' }),
    )
    expect(getRun(run.id)?.rounds).toBe(3) // mesh_run 跨轮累计
  })

  it('stop 后不再排下一轮，mesh_run 终态', async () => {
    mockedCollab.mockImplementation(async () => result('r'))
    const run = createRun('acc-stop', 1000)
    startRunner({ controlId: run.id, accountId: 'acc-stop', intervalMs: 1000, snapshot: () => ({}) })
    await jest.advanceTimersByTimeAsync(0)
    expect(getActiveRunner('acc-stop')?.rounds).toBe(1)

    expect(stopRunner('acc-stop')).toBe(true)
    expect(isRunnerActive('acc-stop')).toBe(false)
    expect(getRun(run.id)?.status).toBe('stopped')

    const callsBefore = mockedCollab.mock.calls.length
    await jest.advanceTimersByTimeAsync(5000)
    expect(mockedCollab.mock.calls.length).toBe(callsBefore) // 停后再推进时间也不跑
  })

  it('当轮抛错记 lastError，循环继续', async () => {
    let n = 0
    mockedCollab.mockImplementation(async () => {
      n++
      if (n === 1) throw new Error('boom')
      return result('r' + n)
    })
    const run = createRun('acc-err', 1000)
    startRunner({ controlId: run.id, accountId: 'acc-err', intervalMs: 1000, snapshot: () => ({}) })
    await jest.advanceTimersByTimeAsync(0)
    expect(getRun(run.id)?.lastError).toContain('boom')
    expect(getActiveRunner('acc-err')?.rounds).toBe(0) // 失败轮不计数
    await jest.advanceTimersByTimeAsync(1000)
    expect(getActiveRunner('acc-err')?.rounds).toBe(1) // 下一轮成功
  })

  it('stopRunner 对不存在账户返回 false', () => {
    expect(stopRunner('nope')).toBe(false)
  })
})
