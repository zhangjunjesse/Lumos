/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
import { NextRequest } from 'next/server'

jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { GET, POST } from '../route'
import { createWorkshop } from '@/lib/mesh/mesh-workshop-store'
import { getDb } from '@/lib/db/connection'

function getReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`)
}

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/mesh/agents', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('/api/mesh/agents', () => {
  it('rejects unknown workshop instead of seeding hidden agents', async () => {
    const res = await GET(getReq('/api/mesh/agents?accountId=ghost_ws'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain('unknown mesh workshop')
    const row = getDb().prepare("SELECT COUNT(*) AS c FROM mesh_agent WHERE workshop_id='ghost_ws'").get() as { c: number }
    expect(row.c).toBe(0)
  })

  it('allows writes for an existing workshop', async () => {
    createWorkshop({ id: 'ws_agents_route', name: 'Agents Route' })

    const res = await POST(postReq({ accountId: 'ws_agents_route', id: 'example.member', action: 'setEnabled', enabled: false }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.agents.find((a: { id: string; enabled: boolean }) => a.id === 'example.member')?.enabled).toBe(false)
  })
})
