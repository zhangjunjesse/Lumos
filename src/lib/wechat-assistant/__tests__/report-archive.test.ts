import Database from 'better-sqlite3';

import { migrateWeChatAssistantTables } from '@/lib/db/migrations-wechat-assistant';

let mockDb: Database.Database;

jest.mock('@/lib/db', () => ({
  getDb: () => mockDb,
}));

import {
  archiveWeChatAutomationReport,
  deleteArchivedWeChatAutomationReport,
  getArchivedWeChatAutomationReport,
  isArchivedWeChatAutomationReportDeleted,
  listArchivedWeChatAutomationReports,
  updateArchivedWeChatAutomationReportStatus,
} from '../report-archive';

describe('wechat assistant report archive', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    migrateWeChatAssistantTables(mockDb);
  });

  afterEach(() => {
    mockDb.close();
  });

  it('archives generated reports and updates the same run snapshot', () => {
    archiveWeChatAutomationReport({
      automationId: 'auto-1',
      automationName: '每日微信总结',
      scheduleId: 'schedule-1',
      runId: 'run-1',
      status: 'running',
      startedAt: '2026-05-06T08:00:00.000Z',
      summary: '正在生成',
    });

    archiveWeChatAutomationReport({
      automationId: 'auto-1',
      automationName: '每日微信总结',
      scheduleId: 'schedule-1',
      runId: 'run-1',
      status: 'success',
      startedAt: '2026-05-06T08:00:00.000Z',
      completedAt: '2026-05-06T08:00:05.000Z',
      summary: '今日微信新增 12 条消息。',
      reportMarkdown: '# 每日微信总结\n\n正文',
      reportFileName: 'wechat-daily-summary.md',
    });

    expect(listArchivedWeChatAutomationReports()).toEqual([
      expect.objectContaining({
        id: 'run-1',
        automationId: 'auto-1',
        status: 'success',
        summary: '今日微信新增 12 条消息。',
        reportFileName: 'wechat-daily-summary.md',
      }),
    ]);
  });

  it('syncs the final scheduler status back to an archived report', () => {
    archiveWeChatAutomationReport({
      automationId: 'auto-1',
      automationName: '每日微信总结',
      scheduleId: 'schedule-1',
      runId: 'run-1',
      status: 'success',
      startedAt: '2026-05-06T08:00:00.000Z',
      summary: '报告已生成',
    });

    updateArchivedWeChatAutomationReportStatus('run-1', 'error', '通知节点失败');

    expect(listArchivedWeChatAutomationReports()[0]).toEqual(expect.objectContaining({
      id: 'run-1',
      status: 'error',
      error: '通知节点失败',
    }));
  });

  it('soft-deletes reports from list and detail queries', () => {
    archiveWeChatAutomationReport({
      automationId: 'auto-1',
      automationName: '每日微信总结',
      scheduleId: 'schedule-1',
      runId: 'run-1',
      status: 'success',
      startedAt: '2026-05-06T08:00:00.000Z',
      summary: '报告已生成',
      reportMarkdown: '# 每日微信总结',
    });

    expect(deleteArchivedWeChatAutomationReport('run-1')).toBe(true);
    expect(isArchivedWeChatAutomationReportDeleted('run-1')).toBe(true);
    expect(getArchivedWeChatAutomationReport('run-1')).toBeNull();
    expect(listArchivedWeChatAutomationReports()).toEqual([]);
  });

  it('does not report a missing archive row as deleted', () => {
    expect(deleteArchivedWeChatAutomationReport('missing')).toBe(false);
    expect(isArchivedWeChatAutomationReportDeleted('missing')).toBe(false);
  });

  it('can create a deleted tombstone for live reports that were not archived yet', () => {
    expect(deleteArchivedWeChatAutomationReport('live-run-1', { tombstoneMissing: true })).toBe(true);
    expect(isArchivedWeChatAutomationReportDeleted('live-run-1')).toBe(true);
    expect(getArchivedWeChatAutomationReport('live-run-1')).toBeNull();
    expect(listArchivedWeChatAutomationReports()).toEqual([]);

    archiveWeChatAutomationReport({
      automationId: 'auto-1',
      automationName: '每日微信总结',
      scheduleId: 'schedule-1',
      runId: 'live-run-1',
      status: 'success',
      startedAt: '2026-05-06T08:00:00.000Z',
      summary: '后续归档不应重新显示',
      reportMarkdown: '# 每日微信总结',
    });

    expect(isArchivedWeChatAutomationReportDeleted('live-run-1')).toBe(true);
    expect(listArchivedWeChatAutomationReports()).toEqual([]);
  });

  it('resolves schedule and run ids from a workflow session', () => {
    mockDb.exec(`
      CREATE TABLE schedule_run_history (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        session_id TEXT,
        browser_context_id TEXT,
        status TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        workflow_dsl_snapshot TEXT
      );
    `);
    mockDb.prepare(`
      INSERT INTO schedule_run_history
        (id, schedule_id, session_id, browser_context_id, status, started_at)
      VALUES ('run-2', 'schedule-2', 'session-2', '', 'running', '2026-05-06T09:00:00.000Z')
    `).run();

    const archived = archiveWeChatAutomationReport({
      automationId: 'auto-2',
      automationName: '每日微信总结',
      workflowSessionId: 'session-2',
      status: 'success',
      summary: '已生成',
    });

    expect(archived).toEqual(expect.objectContaining({
      id: 'run-2',
      scheduleId: 'schedule-2',
      runId: 'run-2',
      startedAt: '2026-05-06T09:00:00.000Z',
    }));
  });
});
