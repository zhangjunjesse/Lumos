/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
import { NextRequest } from 'next/server'

jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

jest.mock('@/lib/mesh/mesh-leader', () => ({
  runLeader: jest.fn(),
  applyCommands: jest.fn(),
}))

import { POST } from '../route'
import { applyCommands, runLeader } from '@/lib/mesh/mesh-leader'
import { createWorkshop } from '@/lib/mesh/mesh-workshop-store'

const mockedRunLeader = jest.mocked(runLeader)
const mockedApplyCommands = jest.mocked(applyCommands)

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/mesh/command', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('/api/mesh/command', () => {
  beforeEach(() => {
    mockedRunLeader.mockReset()
    mockedApplyCommands.mockReset()
  })

  it('applies leader commands to the requested workshop, not the default workshop', async () => {
    createWorkshop({ id: 'ws_cmd', name: '命令工作室' })
    mockedRunLeader.mockResolvedValue({
      reply: '已切换只看不买',
      commands: [{ type: 'set_mode', mode: 'observe_only' }],
    })
    mockedApplyCommands.mockReturnValue({
      applied: [{ command: { type: 'set_mode', mode: 'observe_only' }, relaxesRisk: false }],
      config: { mode: 'observe_only', focus: '', blacklist: [] },
    })

    const res = await POST(makeReq({ message: '先只看不买', accountId: 'ws_cmd' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockedRunLeader).toHaveBeenCalledWith('先只看不买', { sessionId: undefined, workshopId: 'ws_cmd' })
    expect(mockedApplyCommands).toHaveBeenCalledWith('先只看不买', [{ type: 'set_mode', mode: 'observe_only' }], 'ws_cmd')
    expect(body.config.mode).toBe('observe_only')
  })

  it('rejects commands for unknown workshops', async () => {
    const res = await POST(makeReq({ message: '只看不买', accountId: 'ghost_ws' }))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain('unknown mesh workshop')
    expect(mockedRunLeader).not.toHaveBeenCalled()
  })
})
