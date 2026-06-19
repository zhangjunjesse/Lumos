// 直接建内存库验迁移，不走 connection mock
import Database from 'better-sqlite3'
import { migrateMeshTables } from '@/lib/db/migrations-mesh'

describe('mesh migration —— workshop_id 隔离迁移（W2）', () => {
  it('旧库（mesh_agent/team_config PK=id，无 workshop_id）→ 重建复合 PK + 数据保留 + 归默认工作室', () => {
    const db = new Database(':memory:')
    // 模拟 S1 后旧 schema：PK=id + work_mode，但无 workshop_id
    db.exec(`CREATE TABLE mesh_agent (
      id TEXT PRIMARY KEY, role TEXT NOT NULL, system_prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '', mcp_json TEXT NOT NULL DEFAULT '[]', tool_json TEXT NOT NULL DEFAULT '[]',
      topics_json TEXT NOT NULL DEFAULT '[]', interval_sec INTEGER NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
      work_mode TEXT NOT NULL DEFAULT 'event_driven', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    db.prepare(`INSERT INTO mesh_agent (id, role, system_prompt) VALUES ('stock.observe', 'observe', '旧盯盘')`).run()
    db.exec(`CREATE TABLE mesh_team_config (
      id TEXT PRIMARY KEY, blacklist_json TEXT NOT NULL DEFAULT '[]', focus TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'auto', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    db.prepare(`INSERT INTO mesh_team_config (id, focus) VALUES ('default', '旧关注')`).run()

    migrateMeshTables(db) // 应重建成复合 PK (workshop_id, id)

    const agentPk = db.prepare("SELECT count(*) AS c FROM pragma_table_info('mesh_agent') WHERE pk > 0").get() as { c: number }
    expect(agentPk.c).toBe(2) // 复合主键
    const a = db.prepare("SELECT system_prompt, workshop_id FROM mesh_agent WHERE id='stock.observe'").get() as { system_prompt: string; workshop_id: string }
    expect(a.system_prompt).toBe('旧盯盘') // 数据保留
    expect(a.workshop_id).toBe('mesh_team_default') // 归默认工作室
    const cfg = db.prepare("SELECT focus, workshop_id FROM mesh_team_config WHERE id='default'").get() as { focus: string; workshop_id: string }
    expect(cfg.focus).toBe('旧关注')
    expect(cfg.workshop_id).toBe('mesh_team_default')

    migrateMeshTables(db) // 幂等：再跑一遍不破、不重复重建
    expect((db.prepare("SELECT count(*) AS c FROM pragma_table_info('mesh_agent') WHERE pk > 0").get() as { c: number }).c).toBe(2)
    expect((db.prepare("SELECT count(*) AS c FROM mesh_agent WHERE id='stock.observe'").get() as { c: number }).c).toBe(1)
    db.close()
  })

  it('全新库：agent/team_config/risk 直接复合 PK + 默认工作室已种', () => {
    const db = new Database(':memory:')
    migrateMeshTables(db)
    for (const t of ['mesh_agent', 'mesh_team_config', 'mesh_risk_rules']) {
      const pk = db.prepare(`SELECT count(*) AS c FROM pragma_table_info('${t}') WHERE pk > 0`).get() as { c: number }
      expect(pk.c).toBe(2)
    }
    const ws = db.prepare("SELECT name FROM mesh_workshop WHERE id='mesh_team_default'").get() as { name: string }
    expect(ws.name).toBe('默认工作室')
    db.close()
  })
})
