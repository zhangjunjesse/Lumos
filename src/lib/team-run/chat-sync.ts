import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { parseCompiledRunPlan } from './compiler';
import { taskEventBus, type TaskEventType } from '@/lib/task-event-bus';

type TeamRunChatEventType =
  | 'run.started'
  | 'stage.started'
  | 'stage.completed'
  | 'stage.failed'
  | 'stage.blocked'
  | 'run.cancelled'
  | 'summary.generated';

interface RunRow {
  id: string;
  session_id: string | null;
  summary: string;
  final_summary: string;
  published_at: string | null;
  compiled_plan_json: string;
}

interface StageRow {
  id: string;
  name: string;
  latest_result: string | null;
  error: string | null;
  status: string;
}

interface ArtifactRow {
  id: string;
  source_path: string | null;
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function addChatMessage(
  db: Database.Database,
  sessionId: string,
  content: string,
): { id: string } {
  const id = randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, created_at, token_usage)
    VALUES (?, ?, 'assistant', ?, ?, NULL)
  `).run(id, sessionId, content, now);

  db.prepare(`
    UPDATE chat_sessions
    SET updated_at = ?
    WHERE id = ?
  `).run(now, sessionId);

  return { id };
}

function truncate(value: string | null | undefined, maxLength: number): string {
  const normalized = value?.trim() || '';
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function countCompletedStages(stages: StageRow[]): number {
  return stages.filter((stage) => stage.status === 'done').length;
}

function buildRunTitle(run: RunRow): string {
  const compiledPlan = parseCompiledRunPlan(run.compiled_plan_json);
  return truncate(
    compiledPlan?.publicTaskContext.summary
      || compiledPlan?.publicTaskContext.userGoal
      || run.summary
      || '团队任务',
    120,
  ) || '团队任务';
}

function buildProgressMessage(
  run: RunRow,
  stages: StageRow[],
  eventType: TeamRunChatEventType,
  stage?: StageRow,
  errorMessage?: string,
): string | null {
  const title = buildRunTitle(run);
  const total = stages.length;
  const completed = countCompletedStages(stages);

  switch (eventType) {
    case 'run.started':
      return `团队运行已开始：《${title}》。总阶段 ${total} 个，接下来我会继续同步进展。`;
    case 'stage.started':
      return stage
        ? `团队进度 ${completed}/${total}：开始处理《${stage.name}》。`
        : null;
    case 'stage.completed':
      return stage
        ? [
            `团队进度 ${completed}/${total}：已完成《${stage.name}》。`,
            truncate(stage.latest_result, 220),
          ].filter(Boolean).join('\n')
        : null;
    case 'stage.failed':
    case 'stage.blocked':
      return stage
        ? [
            `团队执行在《${stage.name}》遇到问题。`,
            truncate(errorMessage || stage.error, 260),
          ].filter(Boolean).join('\n')
        : null;
    case 'run.cancelled':
      return `团队运行《${title}》已取消。当前完成 ${completed}/${total} 个阶段。`;
    case 'summary.generated':
      return run.final_summary.trim() || null;
    default:
      return null;
  }
}

const CHAT_TO_TASK_EVENT_MAP: Partial<Record<TeamRunChatEventType, TaskEventType>> = {
  'run.started': 'run:started',
  'stage.started': 'stage:started',
  'stage.completed': 'stage:completed',
  'stage.failed': 'stage:failed',
  'stage.blocked': 'stage:failed',
  'run.cancelled': 'run:cancelled',
  'summary.generated': 'run:completed',
};

function mapChatEventToTaskEvent(eventType: TeamRunChatEventType): TaskEventType | undefined {
  return CHAT_TO_TASK_EVENT_MAP[eventType];
}

export function publishTeamRunChatUpdate(params: {
  db: Database.Database;
  runId: string;
  eventType: TeamRunChatEventType;
  stageId?: string;
  errorMessage?: string;
}): string | null {
  if (!tableExists(params.db, 'messages') || !tableExists(params.db, 'chat_sessions')) {
    return null;
  }

  const db = params.db;
  const run = db.prepare(`
    SELECT id, session_id, summary, final_summary, published_at, compiled_plan_json
    FROM team_runs
    WHERE id = ?
  `).get(params.runId) as RunRow | undefined;

  if (!run?.session_id) {
    return null;
  }

  if (params.eventType === 'summary.generated' && run.published_at) {
    return null;
  }

  const stages = db.prepare(`
    SELECT id, name, latest_result, error, status
    FROM team_run_stages
    WHERE run_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(params.runId) as StageRow[];
  const stage = params.stageId
    ? stages.find((item) => item.id === params.stageId)
    : undefined;
  let content = buildProgressMessage(run, stages, params.eventType, stage, params.errorMessage);
  if (content && params.eventType === 'summary.generated') {
    const artifact = db.prepare(`
      SELECT id, source_path
      FROM team_run_artifacts
      WHERE run_id = ? AND source_path = 'final-summary.md'
      LIMIT 1
    `).get(params.runId) as ArtifactRow | undefined;
    if (artifact) {
      content = `${content}\n\n报告路径：/api/team-runs/${params.runId}/artifacts/${artifact.id}`;
    }
  }
  if (!content) {
    return null;
  }

  // Emit SSE event
  const sseType = mapChatEventToTaskEvent(params.eventType);
  if (sseType) {
    const taskRow = run.session_id
      ? db.prepare('SELECT id FROM tasks WHERE session_id = ? AND current_run_id = ?').get(run.session_id, params.runId) as { id: string } | undefined
      : undefined;
    taskEventBus.emitTaskEvent({
      type: sseType,
      sessionId: run.session_id,
      taskId: taskRow?.id || '',
      runId: params.runId,
      stageId: params.stageId,
      timestamp: Date.now(),
      data: { eventType: params.eventType, stageStatus: stage?.status },
    });
  }

  const message = addChatMessage(db, run.session_id, content);
  if (params.eventType === 'summary.generated') {
    const publishedAt = new Date().toISOString();
    db.prepare(`
      UPDATE team_runs
      SET published_at = ?, projection_version = projection_version + 1
      WHERE id = ?
    `).run(publishedAt, params.runId);
    db.prepare(`
      INSERT INTO team_run_events (id, run_id, stage_id, event_type, payload_json, created_at)
      VALUES (lower(hex(randomblob(16))), ?, NULL, ?, ?, ?)
    `).run(
      params.runId,
      'summary.published',
      JSON.stringify({ messageId: message.id, publishedAt }),
      Date.now(),
    );
  }

  return message.id;
}
