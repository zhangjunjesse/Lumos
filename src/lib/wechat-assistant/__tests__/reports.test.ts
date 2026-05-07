const mockListWeChatAutomations = jest.fn();
const mockListRunHistory = jest.fn();
const mockGetScheduleRunDetail = jest.fn();
const mockArchiveWeChatAutomationReport = jest.fn();
const mockListArchivedWeChatAutomationReports = jest.fn();
const mockIsArchivedWeChatAutomationReportDeleted = jest.fn();
const mockGetRunHistory = jest.fn();

jest.mock('../automations', () => ({
  listWeChatAutomations: () => mockListWeChatAutomations(),
}));

jest.mock('@/lib/db/scheduled-workflows', () => ({
  listRunHistory: (...args: unknown[]) => mockListRunHistory(...args),
  getRunHistory: (...args: unknown[]) => mockGetRunHistory(...args),
}));

jest.mock('@/lib/workflow/schedule-run-detail', () => ({
  getScheduleRunDetail: (...args: unknown[]) => mockGetScheduleRunDetail(...args),
}));

jest.mock('../report-archive', () => ({
  archiveWeChatAutomationReport: (...args: unknown[]) => mockArchiveWeChatAutomationReport(...args),
  isArchivedWeChatAutomationReportDeleted: (...args: unknown[]) => mockIsArchivedWeChatAutomationReportDeleted(...args),
  listArchivedWeChatAutomationReports: (...args: unknown[]) => mockListArchivedWeChatAutomationReports(...args),
}));

import { listWeChatAutomationReports } from '../reports';

describe('wechat assistant reports', () => {
  beforeEach(() => {
    mockListWeChatAutomations.mockReset();
    mockListRunHistory.mockReset();
    mockGetScheduleRunDetail.mockReset();
    mockArchiveWeChatAutomationReport.mockReset();
    mockListArchivedWeChatAutomationReports.mockReset();
    mockIsArchivedWeChatAutomationReportDeleted.mockReset();
    mockGetRunHistory.mockReset();
    mockIsArchivedWeChatAutomationReportDeleted.mockReturnValue(false);
  });

  it('keeps list previews short while exposing full text for search and archive', async () => {
    const longMarkdown = `# 每日微信总结\n\n${'长报告正文'.repeat(1200)}`;
    mockListWeChatAutomations.mockReturnValue([{
      id: 'auto-1',
      name: '每日微信总结',
      scheduleId: 'schedule-1',
    }]);
    mockListRunHistory.mockReturnValue([{ id: 'run-1' }]);
    mockGetScheduleRunDetail.mockResolvedValue({
      run: {
        id: 'run-1',
        status: 'success',
        startedAt: '2026-05-06T08:00:00.000Z',
        completedAt: '2026-05-06T08:00:05.000Z',
        error: '',
      },
      outputFiles: [{
        name: 'wechat-daily-summary.md',
        mimeType: 'text/markdown',
        content: longMarkdown,
      }],
      stepOverlays: {
        generate_report: { outputSummary: '今日微信总结已生成。' },
      },
    });
    mockListArchivedWeChatAutomationReports.mockReturnValue([]);

    const reports = await listWeChatAutomationReports();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.reportMarkdown).toBe(longMarkdown.trim().slice(0, 3000));
    expect(reports[0]?.searchText).toBe(longMarkdown.trim());
    expect(mockArchiveWeChatAutomationReport).toHaveBeenCalledWith(expect.objectContaining({
      id: 'run-1',
      reportMarkdown: longMarkdown.trim(),
      reportFileName: 'wechat-daily-summary.md',
    }));
  });

  it('keeps archived reports visible when a live run detail is broken', async () => {
    mockListWeChatAutomations.mockReturnValue([{
      id: 'auto-1',
      name: '每日微信总结',
      scheduleId: 'schedule-1',
    }]);
    mockListRunHistory.mockReturnValue([{ id: 'broken-run' }]);
    mockGetScheduleRunDetail.mockRejectedValue(new Error('detail read failed'));
    mockListArchivedWeChatAutomationReports.mockReturnValue([{
      id: 'archived-run',
      automationId: 'auto-1',
      automationName: '每日微信总结',
      scheduleId: 'schedule-1',
      runId: 'archived-run',
      status: 'success',
      startedAt: '2026-05-06T08:00:00.000Z',
      completedAt: '2026-05-06T08:00:05.000Z',
      summary: '已归档',
      error: '',
      reportMarkdown: '# 已归档',
      reportFileName: 'wechat-daily-summary.md',
    }]);
    mockGetRunHistory.mockReturnValue(null);

    const reports = await listWeChatAutomationReports();

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      id: 'archived-run',
      summary: '已归档',
      searchText: '# 已归档',
      detailAvailable: false,
    });
  });
});
