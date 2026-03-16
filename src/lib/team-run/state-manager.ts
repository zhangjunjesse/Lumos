import Database from 'better-sqlite3'
import { SQLValidator } from './security/sql-validator'
import { ArtifactValidator } from './security/artifact-validator'
import { randomBytes } from 'crypto'

function generateId(): string {
  return randomBytes(16).toString('base64url').slice(0, 21)
}

type StageStatusType = 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed' | 'cancelled'
type RunStatus = 'pending' | 'ready' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

interface StageUpdate {
  stageId: string
  status?: StageStatusType
  result?: string
  error?: string
}

interface ArtifactInput {
  runId: string
  stageId: string
  type: 'output' | 'file' | 'log' | 'metadata'
  title?: string
  sourcePath?: string
  content: Buffer | string
  contentType: string
}

interface StageResultRef {
  artifactId?: string
}

export class StateManager {
  private pendingUpdates: StageUpdate[] = []
  private flushTimer?: NodeJS.Timeout

  constructor(private db: Database.Database) {}

  async updateStageStatus(stageId: string, status: StageStatusType): Promise<void> {
    SQLValidator.validateId(stageId, 'stageId')

    this.db.prepare(`
      UPDATE team_run_stages
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, Date.now(), stageId)
  }

  async updateStageResult(stageId: string, result: string): Promise<StageResultRef> {
    SQLValidator.validateId(stageId, 'stageId')

    const size = Buffer.byteLength(result, 'utf8')

    if (size < 10 * 1024) {
      // 小数据：直接存储
      this.db.prepare(`
        UPDATE team_run_stages
        SET latest_result = ?, latest_result_ref = NULL, updated_at = ?
        WHERE id = ?
      `).run(result, Date.now(), stageId)
      return {}
    } else {
      // 大数据：存储到artifacts表
      const stage = this.db.prepare('SELECT run_id FROM team_run_stages WHERE id = ?').get(stageId) as any

      const artifactId = await this.saveArtifact({
        runId: stage.run_id,
        stageId,
        type: 'output',
        content: result,
        contentType: 'text/plain'
      })

      const reference = JSON.stringify({ type: 'artifact', artifactId, size })
      this.db.prepare(`
        UPDATE team_run_stages
        SET latest_result = ?, latest_result_ref = ?, updated_at = ?
        WHERE id = ?
      `).run(reference, artifactId, Date.now(), stageId)
      return { artifactId }
    }
  }

  async updateStageError(stageId: string, error: string): Promise<void> {
    SQLValidator.validateId(stageId, 'stageId')

    this.db.prepare(`
      UPDATE team_run_stages
      SET error = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(error, error, Date.now(), stageId)
  }

  async getStageOutput(stageId: string): Promise<string> {
    SQLValidator.validateId(stageId, 'stageId')

    const stage = this.db.prepare('SELECT latest_result FROM team_run_stages WHERE id = ?').get(stageId) as any

    if (!stage?.latest_result) return ''

    // 尝试解析为引用
    try {
      const ref = JSON.parse(stage.latest_result)
      if (ref.type === 'artifact') {
        const artifact = this.db.prepare('SELECT content FROM team_run_artifacts WHERE id = ?').get(ref.artifactId) as any
        return artifact.content.toString('utf8')
      }
    } catch {
      // 不是JSON，直接返回
    }

    return stage.latest_result
  }

  async saveArtifact(input: ArtifactInput): Promise<string> {
    await ArtifactValidator.validate(input)

    const id = generateId()
    const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8')

    this.db.prepare(`
      INSERT INTO team_run_artifacts (id, run_id, stage_id, type, title, source_path, content, content_type, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.runId,
      input.stageId,
      input.type,
      input.title || '',
      input.sourcePath || null,
      content,
      input.contentType,
      content.length,
      Date.now(),
    )

    return id
  }

  async attachStageResultRef(stageId: string, artifactId: string): Promise<void> {
    SQLValidator.validateId(stageId, 'stageId')
    SQLValidator.validateId(artifactId, 'artifactId')

    this.db.prepare(`
      UPDATE team_run_stages
      SET latest_result_ref = COALESCE(latest_result_ref, ?), updated_at = ?
      WHERE id = ?
    `).run(artifactId, Date.now(), stageId)
  }

  async batchUpdateStages(updates: StageUpdate[]): Promise<void> {
    const transaction = this.db.transaction(() => {
      for (const update of updates) {
        SQLValidator.validateId(update.stageId, 'stageId')

        if (update.status) {
          this.db.prepare('UPDATE team_run_stages SET status = ?, updated_at = ? WHERE id = ?')
            .run(update.status, Date.now(), update.stageId)
        }
        if (update.result) {
          this.db.prepare('UPDATE team_run_stages SET latest_result = ?, updated_at = ? WHERE id = ?')
            .run(update.result, Date.now(), update.stageId)
        }
        if (update.error) {
          this.db.prepare('UPDATE team_run_stages SET error = ?, updated_at = ? WHERE id = ?')
            .run(update.error, Date.now(), update.stageId)
        }
      }
    })

    transaction()
  }

  async updateRunStatus(runId: string, status: RunStatus): Promise<void> {
    SQLValidator.validateId(runId, 'runId')

    this.db.prepare('UPDATE team_runs SET status = ? WHERE id = ?').run(status, runId)
  }
}
