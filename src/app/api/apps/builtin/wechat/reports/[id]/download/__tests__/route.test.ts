const mockGetArchivedWeChatAutomationReport = jest.fn();
const mockListWeChatAutomationReports = jest.fn();

jest.mock('@/lib/wechat-assistant/report-archive', () => ({
  getArchivedWeChatAutomationReport: (id: string) => mockGetArchivedWeChatAutomationReport(id),
}));
jest.mock('@/lib/wechat-assistant/reports', () => ({
  listWeChatAutomationReports: () => mockListWeChatAutomationReports(),
}));

import { GET } from '../route';

describe('wechat report download route', () => {
  beforeEach(() => {
    mockGetArchivedWeChatAutomationReport.mockReset();
    mockListWeChatAutomationReports.mockReset();
    mockListWeChatAutomationReports.mockResolvedValue([]);
  });

  it('returns the archived markdown as a downloadable file', async () => {
    mockGetArchivedWeChatAutomationReport.mockReturnValue({
      id: 'run-1',
      automationId: 'auto-1',
      automationName: '每日微信总结',
      scheduleId: 'schedule-1',
      runId: 'run-1',
      status: 'success',
      startedAt: '2026-05-06T08:00:00.000Z',
      completedAt: '2026-05-06T08:00:05.000Z',
      summary: '摘要',
      error: '',
      reportMarkdown: '# 每日微信总结\n\n正文',
      reportFileName: 'wechat-daily-summary.md',
      createdAt: 1,
      updatedAt: 1,
    });

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'run-1' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('content-disposition')).toContain(encodeURIComponent('每日微信总结-202605060800.md'));
    expect(await res.text()).toBe('# 每日微信总结\n\n正文');
  });

  it('falls back to summary markdown when the archived report has no body', async () => {
    mockGetArchivedWeChatAutomationReport.mockReturnValue({
      id: 'run-2',
      automationId: 'auto-2',
      automationName: '国信提醒',
      scheduleId: '',
      runId: 'run-2',
      status: 'error',
      startedAt: '2026-05-06T09:00:00.000Z',
      completedAt: '2026-05-06T09:01:00.000Z',
      summary: '摘要',
      error: '通知失败',
      reportMarkdown: '',
      reportFileName: null,
      createdAt: 1,
      updatedAt: 1,
    });

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'run-2' }),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('通知失败');
  });

  it('returns 404 when the report does not exist', async () => {
    mockGetArchivedWeChatAutomationReport.mockReturnValue(null);
    mockListWeChatAutomationReports.mockResolvedValue([]);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'report_not_found' });
  });

  it('falls back to the live report list when the archive row is missing', async () => {
    mockGetArchivedWeChatAutomationReport.mockReturnValue(null);
    mockListWeChatAutomationReports.mockResolvedValue([{
      id: 'run-live',
      automationId: 'auto-live',
      automationName: '每日微信总结',
      scheduleId: 'schedule-live',
      runId: 'run-live',
      status: 'success',
      startedAt: '2026-05-06T08:00:00.000Z',
      completedAt: '2026-05-06T08:01:00.000Z',
      summary: '摘要',
      error: '',
      reportMarkdown: '# 每日微信总结\n\n正文',
      reportFileName: 'wechat-daily-summary.md',
      detailAvailable: true,
    }]);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'run-live' }),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('# 每日微信总结\n\n正文');
  });
});
