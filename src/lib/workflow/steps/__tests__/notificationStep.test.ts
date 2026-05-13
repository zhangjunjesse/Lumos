// Mocks must be hoisted before imports that pull these modules in.
const dbStore = new Map<string, string>();
const messages: Array<{ sessionId: string; role: string; content: string }> = [];
const sessions: Array<{ id: string; system_prompt: string }> = [];
let createdSessionCounter = 0;
jest.mock('@/lib/db', () => ({
  getSetting: (key: string) => dbStore.get(key),
  setSetting: (key: string, value: string) => {
    dbStore.set(key, value);
  },
  addMessage: (sessionId: string, role: string, content: string) => {
    messages.push({ sessionId, role, content });
  },
  getAllSessions: () => sessions.slice(),
  createSession: (title: string, _wd?: string, systemPrompt?: string) => {
    const session = { id: `main-${++createdSessionCounter}`, title, system_prompt: systemPrompt || '' };
    sessions.push(session);
    return session;
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
let defaultUserTarget: { providerId: string; chatId: string } | null = null;
jest.mock('@/lib/im/core/outbound-target', () => ({
  resolveOutboundImTarget: (sessionId: string, providerId: string) => {
    const bound = bindings.get(sessionId);
    if (bound) return { providerId, chatId: bound.channelId, source: 'session-binding' };
    if (providerId === 'wechat' && defaultUserTarget && defaultUserTarget.providerId === providerId) {
      return { providerId, chatId: defaultUserTarget.chatId, source: 'default-user-target' };
    }
    return null;
  },
}));

import { notificationStep } from '../notificationStep';

beforeEach(() => {
  dbStore.clear();
  messages.length = 0;
  sentByProvider.length = 0;
  bindings.clear();
  defaultUserTarget = null;
  sessions.length = 0;
  createdSessionCounter = 0;
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

describe('notificationStep: IM delivery (dual session + IM)', () => {
  test('channel=im pushes via default provider AND writes to session', async () => {
    bindings.set('s1', { id: 100, channelId: 'oc_abc' });

    const result = await notificationStep({
      message: 'IM ping',
      channel: 'im',
      sessionId: 's1',
    });
    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ sessionId: 's1', role: 'assistant' });
    expect(sentByProvider).toEqual([
      { providerId: 'feishu', chatId: 'oc_abc', text: 'IM ping' },
    ]);
    expect(result.metadata?.deliveryMode).toBe('session+im');
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
    expect(messages).toHaveLength(1);
  });

  test('errors when channel=im and no sessionId or targetSessionRef', async () => {
    const result = await notificationStep({ message: 'x', channel: 'im' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sessionId/);
  });

  test('channel=im with no binding still succeeds via session write', async () => {
    const result = await notificationStep({
      message: 'x',
      channel: 'im',
      sessionId: 's-unbound',
    });
    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe('s-unbound');
    expect(sentByProvider).toHaveLength(0);
    expect(result.metadata?.deliveryMode).toBe('session-message');
    expect(result.metadata?.imDelivery).toBe('no-binding');
  });

  test('falls back to session-only when no default provider but sessionId present', async () => {
    const im = jest.requireMock('@/lib/im') as { getDefaultProviderId: jest.Mock };
    im.getDefaultProviderId.mockReturnValueOnce(null);

    const result = await notificationStep({
      message: 'x',
      channel: 'im',
      sessionId: 's1',
    });
    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(result.metadata?.imDelivery).toBe('no-provider');
  });
});

describe('notificationStep: targetSessionRef resolution', () => {
  test('targetSessionRef=main-agent reuses existing main-agent session', async () => {
    sessions.push({ id: 'main-existing', system_prompt: '__LUMOS_MAIN_AGENT__\nyou are the main agent' });
    const result = await notificationStep({
      message: 'report ready',
      channel: 'system',
      targetSessionRef: 'main-agent',
    });
    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe('main-existing');
  });

  test('targetSessionRef=main-agent creates main-agent session when missing', async () => {
    const result = await notificationStep({
      message: 'report ready',
      channel: 'system',
      targetSessionRef: 'main-agent',
    });
    expect(result.success).toBe(true);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].system_prompt).toContain('__LUMOS_MAIN_AGENT__');
    expect(messages[0].sessionId).toBe(sessions[0].id);
  });

  test('targetSessionRef=main-agent with channel=im:wechat does dual delivery via session binding', async () => {
    sessions.push({ id: 'main-x', system_prompt: '__LUMOS_MAIN_AGENT__' });
    bindings.set('main-x', { id: 1, channelId: 'wxid_bound' });

    const result = await notificationStep({
      message: 'daily summary',
      channel: 'im:wechat',
      targetSessionRef: 'main-agent',
    });
    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe('main-x');
    expect(sentByProvider).toEqual([
      { providerId: 'wechat', chatId: 'wxid_bound', text: 'daily summary' },
    ]);
    expect(result.metadata?.deliveryMode).toBe('session+im');
    expect(result.metadata?.targetSource).toBe('session-binding');
  });

  test('wechat channel falls back to defaultUserImTarget when no session binding', async () => {
    sessions.push({ id: 'main-x', system_prompt: '__LUMOS_MAIN_AGENT__' });
    defaultUserTarget = { providerId: 'wechat', chatId: 'wxid_my_filehelper' };

    const result = await notificationStep({
      message: 'daily summary',
      channel: 'im:wechat',
      targetSessionRef: 'main-agent',
    });
    expect(result.success).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].sessionId).toBe('main-x');
    expect(sentByProvider).toEqual([
      { providerId: 'wechat', chatId: 'wxid_my_filehelper', text: 'daily summary' },
    ]);
    expect(result.metadata?.deliveryMode).toBe('session+im');
    expect(result.metadata?.targetSource).toBe('default-user-target');
  });
});
