const mockSendMessage = jest.fn();
const mockAddMessage = jest.fn();

jest.mock('@/lib/bridge/app/bridge-service', () => ({
  getBridgeService: () => ({
    sendMessage: mockSendMessage,
  }),
}));

jest.mock('@/lib/db/sessions', () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
}));

describe('notificationStep', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSendMessage.mockReset();
    mockAddMessage.mockReset();
  });

  test('persists system notifications into session messages when sessionId is provided', async () => {
    mockAddMessage.mockReturnValue({ id: 'msg-system-001' });

    const { notificationStep } = await import('../steps/notificationStep');
    const result = await notificationStep({
      message: 'Workflow finished',
      level: 'warning',
      channel: 'system',
      sessionId: 'session-001',
      __runtime: {
        workflowRunId: 'wf-notify-001',
        stepId: 'notify',
        stepType: 'notification',
      },
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      'session-001',
      'assistant',
      '[Workflow Notification][WARNING] Workflow finished',
      null,
    );
    expect(result).toMatchObject({
      success: true,
      output: {
        messageId: 'msg-system-001',
        channel: 'system',
        sessionId: 'session-001',
      },
      metadata: {
        workflowRunId: 'wf-notify-001',
        stepId: 'notify',
        deliveryMode: 'session-message',
      },
    });
  });

  test('sends feishu notifications through bridge service', async () => {
    mockSendMessage.mockResolvedValue({ ok: true, messageId: 'msg-feishu-001' });

    const { notificationStep } = await import('../steps/notificationStep');
    const result = await notificationStep({
      message: 'Workflow finished',
      level: 'info',
      channel: 'feishu',
      sessionId: 'session-002',
      __runtime: {
        workflowRunId: 'wf-notify-002',
        stepId: 'notify-feishu',
        stepType: 'notification',
      },
    });

    expect(mockSendMessage).toHaveBeenCalledWith({
      sessionId: 'session-002',
      platform: 'feishu',
      mode: 'text',
      content: '[Workflow Notification][INFO] Workflow finished',
    });
    expect(result).toMatchObject({
      success: true,
      output: {
        messageId: 'msg-feishu-001',
        channel: 'feishu',
        sessionId: 'session-002',
      },
      metadata: {
        workflowRunId: 'wf-notify-002',
        stepId: 'notify-feishu',
        deliveryMode: 'feishu',
      },
    });
  });
});
