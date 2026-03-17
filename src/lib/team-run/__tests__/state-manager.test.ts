import Database from 'better-sqlite3'
import { StateManager } from '../state-manager'
import { migrateTeamRunTables } from '../../db/migrations-team-run'

describe('StateManager', () => {
  let db: Database.Database
  let manager: StateManager

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    migrateTeamRunTables(db)
    manager = new StateManager(db)

    // 插入测试数据
    db.prepare(`
      INSERT INTO team_runs (id, plan_id, status, created_at)
      VALUES (?, ?, ?, ?)
    `).run('run-test-001', 'plan-test-001', 'pending', Date.now())

    db.prepare(`
      INSERT INTO team_run_stages (id, run_id, name, role_id, task, status, dependencies, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('stage-test-001', 'run-test-001', 'Stage 1', 'role-test-001', 'Task 1', 'pending', '[]', Date.now(), Date.now())
  })

  afterEach(() => {
    db.close()
  })

  describe('updateStageStatus', () => {
    test('更新stage状态', async () => {
      await manager.updateStageStatus('stage-test-001', 'running')

      const stage = db.prepare('SELECT status FROM team_run_stages WHERE id = ?').get('stage-test-001') as any
      expect(stage.status).toBe('running')
    })
  })

  describe('updateStageResult', () => {
    test('保存小结果到latest_result', async () => {
      const result = 'small output'
      await manager.updateStageResult('stage-test-001', result)

      const stage = db.prepare('SELECT latest_result FROM team_run_stages WHERE id = ?').get('stage-test-001') as any
      expect(stage.latest_result).toBe(result)
    })

    test('大结果保存到artifacts表', async () => {
      const result = 'x'.repeat(15 * 1024) // 15KB
      await manager.updateStageResult('stage-test-001', result)

      const stage = db.prepare('SELECT latest_result, latest_result_ref FROM team_run_stages WHERE id = ?').get('stage-test-001') as any
      const ref = JSON.parse(stage.latest_result)
      expect(ref.type).toBe('artifact')
      expect(ref.artifactId).toBeDefined()
      expect(stage.latest_result_ref).toBe(ref.artifactId)
    })
  })

  describe('getStageOutput', () => {
    test('读取内联结果', async () => {
      await manager.updateStageResult('stage-test-001', 'inline data')
      const output = await manager.getStageOutput('stage-test-001')
      expect(output).toBe('inline data')
    })

    test('读取artifact引用', async () => {
      const largeData = 'x'.repeat(15 * 1024)
      await manager.updateStageResult('stage-test-001', largeData)
      const output = await manager.getStageOutput('stage-test-001')
      expect(output).toBe(largeData)
    })
  })

  describe('updateStageError', () => {
    test('同时写入 error 和 last_error', async () => {
      await manager.updateStageError('stage-test-001', 'boom')
      const stage = db.prepare('SELECT error, last_error FROM team_run_stages WHERE id = ?').get('stage-test-001') as any
      expect(stage.error).toBe('boom')
      expect(stage.last_error).toBe('boom')
    })
  })

  describe('batchUpdateStages', () => {
    test('批量更新多个stage', async () => {
      db.prepare(`
        INSERT INTO team_run_stages (id, run_id, name, role_id, task, status, dependencies, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('stage-test-002', 'run-test-001', 'Stage 2', 'role-test-002', 'Task 2', 'pending', '[]', Date.now(), Date.now())

      await manager.batchUpdateStages([
        { stageId: 'stage-test-001', status: 'done' },
        { stageId: 'stage-test-002', status: 'running' }
      ])

      const stages = db.prepare('SELECT id, status FROM team_run_stages ORDER BY id').all() as any[]
      expect(stages[0].status).toBe('done')
      expect(stages[1].status).toBe('running')
    })
  })
})
