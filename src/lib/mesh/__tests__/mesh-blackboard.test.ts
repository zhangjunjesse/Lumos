// in-memory SQLite，隔离真库
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { writeBlackboard, readBlackboard, readAllBlackboard } from '../mesh-blackboard'
import { getDb } from '@/lib/db/connection'

describe('mesh-blackboard', () => {
  it('writes and reads the latest version', () => {
    const v1 = writeBlackboard('run-1', 'quote', { code: '600160' }, 'observe')
    expect(v1).toBe(1)
    const entry = readBlackboard('run-1', 'quote')
    expect(entry?.value).toEqual({ code: '600160' })
    expect(entry?.writtenBy).toBe('observe')
    expect(entry?.version).toBe(1)
  })

  it('auto-increments version and keeps history (留痕)', () => {
    writeBlackboard('run-2', 'k', 'a', 'p')
    const v2 = writeBlackboard('run-2', 'k', 'b', 'p')
    expect(v2).toBe(2)
    expect(readBlackboard('run-2', 'k')?.value).toBe('b')
    const count = (getDb() as ReturnType<typeof getDb>)
      .prepare('SELECT COUNT(*) AS c FROM mesh_blackboard WHERE run_id = ? AND key = ?')
      .get('run-2', 'k') as { c: number }
    expect(count.c).toBe(2) // 历史版本都保留
  })

  it('readAllBlackboard returns the latest of each key', () => {
    writeBlackboard('run-3', 'a', 1, 'p')
    writeBlackboard('run-3', 'b', 2, 'p')
    writeBlackboard('run-3', 'a', 11, 'p')
    const all = readAllBlackboard('run-3')
    const map = Object.fromEntries(all.map((e) => [e.key, e.value]))
    expect(map).toEqual({ a: 11, b: 2 })
  })

  it('returns null for missing key', () => {
    expect(readBlackboard('run-x', 'nope')).toBeNull()
  })
})
