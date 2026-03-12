import { StageWorker } from '../stage-worker'
import Database from 'better-sqlite3'
import { migrateTeamRunTables } from '../../db/migrations-team-run'

describe('StageWorker', () => {
  let db: Database.Database
  let worker: StageWorker

  beforeEach(() => {
    db = new Database(':memory:')
    migrateTeamRunTables(db)

    worker = new StageWorker()
  })

  afterEach(() => {
    db.close()
  })

  describe('execute', () => {
    test('执行stage并返回结果', async () => {
      const stage = {
        id: 'stage-test-001',
        runId: 'run-test-001',
        name: 'Test Stage',
        roleId: 'role-test-001',
        task: 'Echo hello',
        status: 'pending' as const,
        dependencies: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      const context = {
        runId: 'run-test-001',
        workspace: {
          stageWorkDir: '/tmp/test',
          sharedReadDir: '/tmp/shared',
          outputDir: '/tmp/output'
        },
        dependencies: [],
        budget: {
          maxRunMinutes: 10,
          maxTokens: 100000
        }
      }

      const result = await worker.execute(stage, context)

      expect(result.stageId).toBe('stage-test-001')
      expect(result.status).toBe('done')
      expect(result.output).toBeDefined()
    }, 30000)
  })

  describe('getStatus', () => {
    test('返回worker状态', () => {
      const status = worker.getStatus()
      expect(status.state).toBe('idle')
    })
  })
})
