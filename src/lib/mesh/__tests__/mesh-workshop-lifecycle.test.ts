/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
// mock run-control：隔离 stopMonitoring（它会拉 runner→scheduler→...→SDK），只验 lifecycle 的级联删
jest.mock('../mesh-run-control', () => ({ stopMonitoring: jest.fn() }))

import { deleteWorkshop } from '../mesh-workshop-lifecycle'
import { stopMonitoring } from '../mesh-run-control'
import { createWorkshop, getWorkshop } from '../mesh-workshop-store'
import { listAgents } from '../mesh-agent-store'
import { upsertTeamConfig, getTeamConfig } from '../mesh-team-config'
import { getDb } from '@/lib/db/connection'

const mStop = jest.mocked(stopMonitoring)
const count = (sql: string, ...args: unknown[]) => (getDb().prepare(sql).get(...args) as { c: number }).c

beforeEach(() => {
  mStop.mockReset().mockResolvedValue({ ok: false, reason: '该账户未在盯盘' })
})

describe('deleteWorkshop —— 全删干净（W5）', () => {
  it('先停 runner + 级联删配置/历史 + workshop 行', async () => {
    mStop.mockResolvedValue({ ok: true })
    createWorkshop({ name: '待删工作室', id: 'ws_del' })
    listAgents('ws_del') // 触发 seed 5 个 agents
    upsertTeamConfig('ws_del', { focus: '半导体' })
    const db = getDb()
    db.prepare("INSERT INTO mesh_run (id, account_id, status, last_run_id) VALUES ('mctl_x', 'ws_del', 'stopped', 'mrun_x')").run()
    db.prepare("INSERT INTO mesh_blackboard (run_id, key, version, value_json) VALUES ('mrun_x', 'k', 1, '{}')").run()
    db.prepare("INSERT INTO mesh_message (id, run_id, topic) VALUES ('m1', 'mrun_x', 't')").run()
    db.prepare("INSERT INTO mesh_message_delivery (message_id, subscriber_id) VALUES ('m1', 's1')").run()
    db.prepare("INSERT INTO mesh_participant (run_id, participant_id) VALUES ('mrun_x', 'p1')").run()
    db.prepare("INSERT INTO mesh_paper_account (run_id, cash) VALUES ('ws_del', 100000)").run()

    await deleteWorkshop('ws_del')

    expect(mStop).toHaveBeenCalledWith('ws_del') // 先停 runner
    expect(getWorkshop('ws_del')).toBeNull() // workshop 行删
    // 配置删（getTeamConfig 回落默认；用 SQL 直查 agent，避免 listAgents 触发 re-seed）
    expect(getTeamConfig('ws_del').focus).toBe('')
    expect(count("SELECT count(*) c FROM mesh_agent WHERE workshop_id='ws_del'")).toBe(0)
    expect(count("SELECT count(*) c FROM mesh_team_config WHERE workshop_id='ws_del'")).toBe(0)
    // 运行历史删
    expect(count("SELECT count(*) c FROM mesh_run WHERE account_id='ws_del'")).toBe(0)
    expect(count("SELECT count(*) c FROM mesh_blackboard WHERE run_id='mrun_x'")).toBe(0)
    expect(count("SELECT count(*) c FROM mesh_message WHERE run_id='mrun_x'")).toBe(0)
    expect(count("SELECT count(*) c FROM mesh_message_delivery WHERE message_id='m1'")).toBe(0)
    expect(count("SELECT count(*) c FROM mesh_participant WHERE run_id='mrun_x'")).toBe(0)
    expect(count("SELECT count(*) c FROM mesh_paper_account WHERE run_id='ws_del'")).toBe(0)
  })

  it('停止失败时不删除工作室数据', async () => {
    mStop.mockResolvedValue({ ok: false, reason: '停止超时' })
    createWorkshop({ name: '运行中', id: 'ws_busy' })
    listAgents('ws_busy')

    await expect(deleteWorkshop('ws_busy')).rejects.toThrow('停止超时')

    expect(getWorkshop('ws_busy')).not.toBeNull()
    expect(count("SELECT count(*) c FROM mesh_agent WHERE workshop_id='ws_busy'")).toBe(2)
  })

  it('不波及其它工作室（删 ws_del 不动默认工作室）', async () => {
    createWorkshop({ name: 'X', id: 'ws_keep' })
    listAgents('ws_keep')
    upsertTeamConfig('ws_keep', { focus: '保留' })
    await deleteWorkshop('ws_del2_nonexist') // 删不存在的不报错
    expect(getTeamConfig('ws_keep').focus).toBe('保留')
    expect(count("SELECT count(*) c FROM mesh_agent WHERE workshop_id='ws_keep'")).toBe(2)
  })
})
