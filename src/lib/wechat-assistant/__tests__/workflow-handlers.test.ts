import { getCodeHandler } from '@/lib/workflow/code-handler-registry';
import type { CodeHandlerContext } from '@/lib/workflow/code-handler-types';

const mockRunSync = jest.fn();
const mockLoadWeChatOverview = jest.fn();
const mockBuildDailySummaryReport = jest.fn();
const mockArchiveWeChatAutomationReport = jest.fn();

jest.mock('@/lib/db', () => ({
  getDb: jest.fn(),
}));

jest.mock('../sync-engine', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));

jest.mock('../overview-loader', () => ({
  loadWeChatOverview: (...args: unknown[]) => mockLoadWeChatOverview(...args),
}));

jest.mock('../settings-store', () => ({
  getWeChatAssistantSettings: () => ({
    ai: { windowDays: 14 },
    excludedPersonIds: [],
  }),
}));

jest.mock('../db', () => ({
  listTodos: () => [],
}));

jest.mock('../daily-summary', () => ({
  buildDailySummaryReport: (...args: unknown[]) => mockBuildDailySummaryReport(...args),
  collectRecentMessagesForDailySummary: () => [],
  selectTodosForDailySummary: () => [],
}));

jest.mock('../report-archive', () => ({
  archiveWeChatAutomationReport: (...args: unknown[]) => mockArchiveWeChatAutomationReport(...args),
}));

import '../workflow-handlers';

describe('wechat assistant workflow handlers', () => {
  beforeEach(() => {
    mockRunSync.mockReset();
    mockLoadWeChatOverview.mockReset();
    mockBuildDailySummaryReport.mockReset();
    mockArchiveWeChatAutomationReport.mockReset();
  });

  it('uses the generated report markdown itself as the notification payload', async () => {
    const markdown = '# 每日微信总结\n\n## 今日要点\n\n- 完整报告正文';
    mockRunSync.mockResolvedValue({
      status: 'completed',
      inserted: 1,
      seen: 2,
    });
    mockLoadWeChatOverview.mockResolvedValue({
      ready: true,
      data: {
        totals: { activeChats: 1, messagesInWindow: 2 },
      },
    });
    mockBuildDailySummaryReport.mockResolvedValue({
      markdown,
      summary: '短摘要',
      notification: '旧短通知，不应发送',
      todayMessages: 1,
      ai: { status: 'success', providerId: 'p1', model: 'm1' },
    });

    const handler = getCodeHandler('wechat-assistant.daily-summary');
    const result = await handler!.execute({
      params: {
        automationId: 'auto-1',
        automationName: '每日微信总结',
        messageTemplate: '总结今天微信消息',
      },
      stepId: 'generate_report',
      workflowRunId: 'workflow-run-1',
      runtimeContext: {
        workflowRunId: 'workflow-run-1',
        stepId: 'generate_report',
        stepType: 'agent',
        sessionId: 'session-1',
      },
      upstreamOutputs: {},
      outputDir: '/tmp/lumos-wechat-workflow-handler-test',
      browser: {} as CodeHandlerContext['browser'],
      saveArtifact: jest.fn(),
    } as CodeHandlerContext);

    expect(result.success).toBe(true);
    expect(result.output).toEqual(expect.objectContaining({
      summary: '短摘要',
      notification: markdown,
      reportMarkdown: markdown,
    }));
    expect(mockArchiveWeChatAutomationReport).toHaveBeenCalledWith(expect.objectContaining({
      summary: '短摘要',
      reportMarkdown: markdown,
      reportFileName: 'wechat-daily-summary.md',
    }));
  });
});
