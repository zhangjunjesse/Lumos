const mockDeleteArchivedWeChatAutomationReport = jest.fn();

jest.mock('@/lib/wechat-assistant/report-archive', () => ({
  deleteArchivedWeChatAutomationReport: (id: string, options: unknown) => mockDeleteArchivedWeChatAutomationReport(id, options),
}));

import { DELETE } from '../route';

describe('wechat report detail route', () => {
  beforeEach(() => {
    mockDeleteArchivedWeChatAutomationReport.mockReset();
  });

  it('soft-deletes an archived report', async () => {
    mockDeleteArchivedWeChatAutomationReport.mockReturnValue(true);

    const res = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'run-1' }),
    });

    expect(mockDeleteArchivedWeChatAutomationReport).toHaveBeenCalledWith('run-1', { tombstoneMissing: true });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('treats a missing archive row as deleted so live reports can be hidden', async () => {
    mockDeleteArchivedWeChatAutomationReport.mockReturnValue(true);

    const res = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'live-run-1' }),
    });

    expect(mockDeleteArchivedWeChatAutomationReport).toHaveBeenCalledWith('live-run-1', { tombstoneMissing: true });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
