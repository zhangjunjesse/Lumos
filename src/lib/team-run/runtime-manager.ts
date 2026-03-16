import { getDb } from '@/lib/db/connection'
import { parseCompiledRunPlan } from './compiler'
import { TeamRunOrchestrator } from './orchestrator'

type ActiveRunStore = Set<string>

type RuntimeGlobal = typeof globalThis & {
  __lumosActiveTeamRuns?: ActiveRunStore
}

function getActiveRunStore(): ActiveRunStore {
  const runtime = globalThis as RuntimeGlobal
  if (!runtime.__lumosActiveTeamRuns) {
    runtime.__lumosActiveTeamRuns = new Set<string>()
  }
  return runtime.__lumosActiveTeamRuns
}

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID)
}

export function ensureRunScheduled(runId: string | null | undefined): void {
  if (!runId || isTestEnv()) return

  const db = getDb()
  const run = db.prepare('SELECT status FROM team_runs WHERE id = ?').get(runId) as { status?: string } | undefined
  if (!run) return
  if (['done', 'failed', 'cancelled', 'paused'].includes(run.status || '')) return

  const store = getActiveRunStore()
  if (store.has(runId)) return

  store.add(runId)
  const compiledPlan = db.prepare('SELECT compiled_plan_json FROM team_runs WHERE id = ?').get(runId) as { compiled_plan_json?: string } | undefined
  const budget = parseCompiledRunPlan(compiledPlan?.compiled_plan_json || null)?.budget
  const orchestrator = new TeamRunOrchestrator(db, undefined, budget?.maxParallelWorkers || 3)
  void orchestrator.processRun(runId)
    .catch((error) => {
      console.error('[team-run-runtime] Failed to process run:', error)
    })
    .finally(() => {
      store.delete(runId)
    })
}

export function ensureTaskRunScheduled(taskId: string): void {
  if (!taskId || isTestEnv()) return

  const db = getDb()
  const row = db.prepare('SELECT current_run_id FROM tasks WHERE id = ?').get(taskId) as { current_run_id?: string | null } | undefined
  ensureRunScheduled(row?.current_run_id || null)
}
