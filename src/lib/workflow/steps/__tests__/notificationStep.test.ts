// Mocks must be hoisted before imports that pull these modules in.
const dbStore = new Map<string, string>();
const messages: Array<{ sessionId: string; role: string; content: string }> = [];
jest.mock('@/lib/db', () => ({
  getSetting: (key: string) => dbStore.get(key),
  setSetting: (key: string, value: string) => {
    dbStore.set(key, value);
  },
  addMessage: (sessionId: string, role: string, content: string) => {
    messages.push({ sessionId, role, content });
  },
}));

const sentByProvider: Array<{ providerId: string; chatId: string; text: string }> = [];
jest.mock('@/lib/im', () => ({
  sendToProvider: jest.fn(async (providerId: string, msg: { address: { chatId: string }; text: string }) => {
    sentByProvider.push({ providerId, chatId: msg.address.chatId, text: msg.text });
    return { ok: true, messageId: 'mocked-msg-id' };
  }),
  getDefaultProviderId: jest.fn(() => 'feishu'),
  hasProvider: jest.fn(() => true),
}));

const bindings = new Map<string, { id: number; channelId: string }>();
jest.mock('@/lib/bridge/core/binding-service', () => ({
  BindingService: class {
    getActiveBinding(sessionId: string) {
      return bindings.get(sessionId) || null;
    }
  },
}));

import { notificationStep } from '../notificationStep';

beforeEach(() => {
  dbStore.clear();
  messages.length = 0;
  sentByProvider.length = 0;
  bindings.clear();
});

describe('notificationStep: existing behavior preserved', () => {
  test('rejects empty message', async () => {
    const result = await notificationStep({ message: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/);
  });

  test('writes assistant message when sessionId given and no IM channel', async () => {
    const result = await notificationStep({
      message: 'hello',
      sessionId: 's1',
      channel: 'system',
    });
    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe('s1');
    expect(result.metadata?.deliveryMode).toBe('session-message');
  });

  test('noop when no sessionId and no IM channel', async () => {
    const result = await notificationStep({ message: 'hi', channel: 'log' });
    expect(result.success).toBe(true);
    expect(messages).toHaveLength(0);
    expect(result.metadata?.deliveryMode).toBe('noop');
  });
});

describe('notificationStep: IM delivery (M3.5)', () => {
  test('channel=im uses default provider + binding lookup', async () => {
    bindings.set('s1', { id: 100, channelId: 'oc_abc' });

    const result = await notificationStep({
      message: 'IM ping',
      channel: 'im',
      sessionId: 's1',
    });
    expect(result.success).toBe(true);
    expect(sentByProvider).toEqual([
      { providerId: 'feishu', chatId: 'oc_abc', text: 'IM ping' },
    ]);
    expect(result.metadata?.deliveryMode).toBe('im');
    expect(result.output).toMatchObject({
      providerId: 'feishu',
      chatId: 'oc_abc',
      messageId: 'mocked-msg-id',
    });
  });

  test('channel=im:<provider> uses explicit provider', async () => {
    bindings.set('s2', { id: 200, channelId: 'oc_xyz' });
    const result = await notificationStep({
      message: 'hi',
      channel: 'im:feishu',
      sessionId: 's2',
    });
    expect(result.success).toBe(true);
    expect(sentByProvider[0].providerId).toBe('feishu');
  });

  test('errors when channel=im and no sessionId', async () => {
    const result = await notificationStep({ message: 'x', channel: 'im' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sessionId/);
  });

  test('errors when channel=im and no binding for session', async () => {
    const result = await notificationStep({
      message: 'x',
      channel: 'im',
      sessionId: 's-unbound',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/binding/);
  });

  test('errors when no default provider and channel=im', async () => {
    const im = jest.requireMock('@/lib/im') as { getDefaultProviderId: jest.Mock };
    im.getDefaultProviderId.mockReturnValueOnce(null);

    const result = await notificationStep({
      message: 'x',
      channel: 'im',
      sessionId: 's1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No IM provider/);
  });
});
