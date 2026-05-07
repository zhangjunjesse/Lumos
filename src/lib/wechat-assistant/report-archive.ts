import { randomUUID } from 'node:crypto';

import { getDb } from '@/lib/db';

export type WeChatArchivedReportStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface WeChatArchivedReport {
  id: string;
  automationId: string;
  automationName: string;
  scheduleId: string;
  runId: string;
  status: WeChatArchivedReportStatus;
  startedAt: string;
  completedAt: string | null;
  summary: string;
  error: string;
  reportMarkdown: string;
  reportFileName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ArchiveWeChatAutomationReportInput {
  automationId?: string | null;
  automationName: string;
  scheduleId?: string | null;
  runId?: string | null;
  workflowSessionId?: string | null;
  workflowRunId?: string | null;
  status: WeChatArchivedReportStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  summary: string;
  error?: string | null;
  reportMarkdown?: string | null;
  reportFileName?: string | null;
}

interface ReportRow {
  id: string;
  automation_id: string;
  automation_name: string;
  schedule_id: string;
  run_id: string;
  status: WeChatArchivedReportStatus;
  started_at: string;
  completed_at: string | null;
  summary: string;
  error: string;
  report_markdown: string;
  report_file_name: string | null;
  created_at: number;
  updated_at: number;
}

interface ScheduleRunRef {
  scheduleId: string;
  runId: string;
  startedAt: string;
}

const MAX_SUMMARY_LENGTH = 1_000;
const MAX_ERROR_LENGTH = 2_000;
const MAX_REPORT_LENGTH = 50_000;

export function archiveWeChatAutomationReport(
  input: ArchiveWeChatAutomationReportInput,
): WeChatArchivedReport {
  const ref = resolveScheduleRunRef(input);
  const scheduleId = clean(input.scheduleId) || ref?.scheduleId || '';
  const runId = clean(input.runId) || ref?.runId || '';
  const now = Date.now();
  const id = runId || randomUUID();
  const startedAt = clean(input.startedAt) || ref?.startedAt || new Date(now).toISOString();
  const completedAt = clean(input.completedAt) || (input.status === 'running' ? null : new Date(now).toISOString());

  getDb().prepare(`
    INSERT INTO wechat_assistant_reports
      (id, automation_id, automation_name, schedule_id, run_id, status, started_at, completed_at,
       summary, error, report_markdown, report_file_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      automation_id = excluded.automation_id,
      automation_name = excluded.automation_name,
      schedule_id = excluded.schedule_id,
      run_id = excluded.run_id,
      status = excluded.status,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      summary = excluded.summary,
      error = excluded.error,
      report_markdown = excluded.report_markdown,
      report_file_name = excluded.report_file_name,
      updated_at = excluded.updated_at
  `).run(
    id,
    clean(input.automationId),
    input.automationName.trim() || '微信助手报告',
    scheduleId,
    runId,
    input.status,
    startedAt,
    completedAt,
    limit(input.summary, MAX_SUMMARY_LENGTH),
    limit(input.error ?? '', MAX_ERROR_LENGTH),
    limit(input.reportMarkdown ?? '', MAX_REPORT_LENGTH),
    clean(input.reportFileName) || null,
    now,
    now,
  );

  return getArchivedWeChatAutomationReport(id)!;
}

export function listArchivedWeChatAutomationReports(limit = 50): WeChatArchivedReport[] {
  const rows = getDb().prepare(`
    SELECT * FROM wechat_assistant_reports
     WHERE deleted_at IS NULL
     ORDER BY started_at DESC, created_at DESC
     LIMIT ?
  `).all(limit) as ReportRow[];
  return rows.map(mapReportRow);
}

export function updateArchivedWeChatAutomationReportStatus(
  runId: string,
  status: WeChatArchivedReportStatus,
  error = '',
): void {
  const cleanRunId = clean(runId);
  if (!cleanRunId) return;
  try {
    getDb().prepare(`
      UPDATE wechat_assistant_reports
         SET status = ?,
             error = ?,
             completed_at = CASE WHEN ? = 'running' THEN completed_at ELSE ? END,
             updated_at = ?
       WHERE run_id = ? OR id = ?
    `).run(
      status,
      limit(error, MAX_ERROR_LENGTH),
      status,
      new Date().toISOString(),
      Date.now(),
      cleanRunId,
      cleanRunId,
    );
  } catch {
    // The archive table is best-effort from generic scheduler code.
  }
}

export function getArchivedWeChatAutomationReport(id: string): WeChatArchivedReport | null {
  const row = getDb().prepare(`
    SELECT * FROM wechat_assistant_reports WHERE id = ? AND deleted_at IS NULL
  `).get(id) as ReportRow | undefined;
  return row ? mapReportRow(row) : null;
}

export function deleteArchivedWeChatAutomationReport(
  id: string,
  options: { tombstoneMissing?: boolean } = {},
): boolean {
  const cleanId = clean(id);
  if (!cleanId) return false;
  const now = Date.now();
  const info = getDb().prepare(`
    UPDATE wechat_assistant_reports
       SET deleted_at = ?,
           updated_at = ?
     WHERE id = ?
       AND deleted_at IS NULL
  `).run(now, now, cleanId);
  if (info.changes > 0) return true;
  if (!options.tombstoneMissing) return false;

  getDb().prepare(`
    INSERT INTO wechat_assistant_reports
      (id, automation_id, automation_name, schedule_id, run_id, status, started_at, completed_at,
       summary, error, report_markdown, report_file_name, deleted_at, created_at, updated_at)
    VALUES (?, '', '微信助手报告', '', ?, 'cancelled', ?, ?, '', '', '', NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      deleted_at = excluded.deleted_at,
      updated_at = excluded.updated_at
  `).run(
    cleanId,
    cleanId,
    new Date(now).toISOString(),
    new Date(now).toISOString(),
    now,
    now,
    now,
  );
  return true;
}

export function isArchivedWeChatAutomationReportDeleted(id: string): boolean {
  const cleanId = clean(id);
  if (!cleanId) return false;
  const row = getDb().prepare(`
    SELECT deleted_at FROM wechat_assistant_reports WHERE id = ?
  `).get(cleanId) as { deleted_at?: number | null } | undefined;
  return Boolean(row?.deleted_at);
}

function resolveScheduleRunRef(input: ArchiveWeChatAutomationReportInput): ScheduleRunRef | null {
  const directSessionId = clean(input.workflowSessionId);
  const sessionId = directSessionId || resolveSessionIdFromWorkflowRun(clean(input.workflowRunId));
  if (!sessionId) return null;
  try {
    const row = getDb().prepare(`
      SELECT id, schedule_id, started_at
        FROM schedule_run_history
       WHERE session_id = ?
       ORDER BY started_at DESC
       LIMIT 1
    `).get(sessionId) as { id: string; schedule_id: string; started_at: string } | undefined;
    if (!row) return null;
    return {
      runId: row.id,
      scheduleId: row.schedule_id,
      startedAt: row.started_at,
    };
  } catch {
    return null;
  }
}

function resolveSessionIdFromWorkflowRun(workflowRunId: string): string {
  if (!workflowRunId) return '';
  try {
    const row = getDb().prepare(`
      SELECT task_id
        FROM workflow_task_mapping
       WHERE execution_id = ?
       LIMIT 1
    `).get(workflowRunId) as { task_id?: string } | undefined;
    return row?.task_id ?? '';
  } catch {
    return '';
  }
}

function mapReportRow(row: ReportRow): WeChatArchivedReport {
  return {
    id: row.id,
    automationId: row.automation_id,
    automationName: row.automation_name,
    scheduleId: row.schedule_id,
    runId: row.run_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    summary: row.summary,
    error: row.error,
    reportMarkdown: row.report_markdown,
    reportFileName: row.report_file_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function limit(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? text.slice(0, max) : text;
}
