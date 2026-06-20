/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
// mock scheduler：隔离 runner 的生命周期/注册逻辑，不真起时间轮
jest.mock('../mesh-scheduler', () => ({ startScheduler: jest.fn(), stopScheduler: jest.fn() }))

import { startRunner, stopRunner, getActiveRunner, isRunnerActive, activeAccountIds } from '../mesh-runner'
import { startScheduler, stopScheduler } from '../mesh-scheduler'
import { createRun, getRun } from '../mesh-run'
import { initParticipants, listParticipants } from '../mesh-participant-store'

const mStart = jest.mocked(startScheduler)
const mStop = jest.mocked(stopScheduler)

afterEach(async () => {
  for (const id of activeAccountIds()) await stopRunner(id) // 清残留 runner，避免污染下个用例
  mStart.mockReset()
  mStop.mockReset()
})

describe('mesh-runner 常驻 session', () => {
  it('startRunner：建 runner、启时间轮、进注册表', () => {
    const run = createRun('acc1', 2500, 'mrun_1')
    const r = startRunner({ controlId: run.id, accountId: 'acc1', runId: 'mrun_1', snapshot: () => ({}), tickMs: 2500 })
    expect(isRunnerActive('acc1')).toBe(true)
    expect(getActiveRunner('acc1')?.runId).toBe('mrun_1')
    expect(getActiveRunner('acc1')?.controlId).toBe(run.id)
    expect(mStart).toHaveBeenCalledWith(r) // 启了时间轮
  })

  it('stopRunner：停时间轮 + 清 participant + mesh_run 终态 + 注销', async () => {
    const run = createRun('acc2', 2500, 'mrun_2')
    initParticipants('mrun_2', [{ participantId: 'a', role: 'observe', subscriptions: [], workMode: 'active_loop' }], 0)
    startRunner({ controlId: run.id, accountId: 'acc2', runId: 'mrun_2', snapshot: () => ({}) })
    await expect(stopRunner('acc2')).resolves.toBe(true)
    expect(mStop).toHaveBeenCalled() // abort 透传给在飞 SDK
    expect(isRunnerActive('acc2')).toBe(false)
    expect(getRun(run.id)?.status).toBe('stopped')
    expect(listParticipants('mrun_2')).toHaveLength(0) // participant 行清空（§75 不挂起恢复）
  })

  it('stopRunner：等待在飞 duty cycle 收口后才清 participant/标终态', async () => {
    const run = createRun('acc2b', 2500, 'mrun_2b')
    initParticipants('mrun_2b', [{ participantId: 'a', role: 'observe', subscriptions: [], workMode: 'active_loop' }], 0)
    const r = startRunner({ controlId: run.id, accountId: 'acc2b', runId: 'mrun_2b', snapshot: () => ({}) })
    let release!: () => void
    const task = new Promise<void>((resolve) => {
      release = resolve
    })
    r.inFlightTasks.set('a', task)
    const stopping = stopRunner('acc2b')

    await Promise.resolve()
    expect(isRunnerActive('acc2b')).toBe(true)
    expect(getRun(run.id)?.status).toBe('running')
    expect(listParticipants('mrun_2b')).toHaveLength(1)

    release()
    await expect(stopping).resolves.toBe(true)
    expect(isRunnerActive('acc2b')).toBe(false)
    expect(getRun(run.id)?.status).toBe('stopped')
    expect(listParticipants('mrun_2b')).toHaveLength(0)
  })

  it('onCycle / onError 注入 recordCycle / recordError', () => {
    const run = createRun('acc3', 2500, 'mrun_3')
    const r = startRunner({ controlId: run.id, accountId: 'acc3', runId: 'mrun_3', snapshot: () => ({}) })
    r.onCycle?.()
    r.onCycle?.()
    expect(getRun(run.id)?.rounds).toBe(2) // duty cycle 计数
    r.onError?.('boom')
    expect(getRun(run.id)?.lastError).toBe('boom')
  })

  it('stopRunner 对不存在账户返回 false', async () => {
    await expect(stopRunner('nope')).resolves.toBe(false)
  })
})
