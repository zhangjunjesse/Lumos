import { TeamRunOrchestrator } from '../orchestrator'
import Database from 'better-sqlite3'
import { migrateTeamRunTables } from '../../db/migrations-team-run'

describe('TeamRunOrchestrator', () => {
  let db: Database.Database
  let orchestrator: TeamRunOrchestrator

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    migrateTeamRunTables(db)

    orchestrator = new TeamRunOrchestrator(db)

    // 插入测试数据
    db.prepare(`
      INSERT INTO team_runs (id, plan_id, status, created_at)
      VALUES (?, ?, ?, ?)
    `).run('run-test-001', 'plan-test-001', 'ready', Date.now())

    db.prepare(`
      INSERT INTO team_run_stages (id, run_id, name, role_id, task, status, dependencies, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('stage-test-001', 'run-test-001', 'Stage 1', 'role-test-001', 'Task 1', 'pending', '[]', Date.now(), Date.now())

    db.prepare(`
      INSERT INTO team_run_stages (id, run_id, name, role_id, task, status, dependencies, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('stage-test-002', 'run-test-001', 'Stage 2', 'role-test-002', 'Task 2', 'pending', '["stage-test-001"]', Date.now(), Date.now())
  })

  afterEach(() => {
    db.close()
  })

  describe('startRun', () => {
    test('启动run执行', async () => {
      await orchestrator.startRun('run-test-001')

      const run = db.prepare('SELECT status FROM team_runs WHERE id = ?').get('run-test-001') as any
      expect(run.status).toBe('running')
    })
  })

  describe('getStatus', () => {
    test('获取run状态', async () => {
      const status = await orchestrator.getStatus('run-test-001')

      expect(status.runId).toBe('run-test-001')
      expect(status.stages).toHaveLength(2)
    })
  })
})
