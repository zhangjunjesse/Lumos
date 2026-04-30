// Mock heavy transitive imports at the dispatcher boundary so jest doesn't try
// to load @anthropic-ai/claude-agent-sdk and other ESM deps.

const sendToProvider = jest.fn(async () => ({ ok: true, messageId: 'reply-1' }));
jest.mock('@/lib/im', () => ({
  sendToProvider: (id: string, msg: unknown) => sendToProvider(id, msg),
}));

let mockBinding: { id: number; sessionId: string; status: string } | null = {
  id: 1,
  sessionId: 'sess-1',
  status: 'active',
};

class FakeBindingService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getBindingByChannel(platform: string, channelId: string) {
    return mockBinding;
  }
}

const conversationCalls: Array<{ sessionId: string; text: string; meta: unknown }> = [];
let conversationResponseText = 'AI reply';
let conversationDelay: Promise<void> | null = null;

class FakeConversationEngine {
  async sendMessage(
    sessionId: string,
    text: string,
    _files?: never,
    meta?: { source?: string },
  ) {
    if (conversationDelay) await conversationDelay;
    conversationCalls.push({ sessionId, text, meta });
    return { visibleText: conversationResponseText, rawContent: conversationResponseText };
  }
}

jest.mock('../binding-service', () => ({
  BindingService: FakeBindingService,
}));

jest.mock('../../conversation-engine', () => ({
  ConversationEngine: FakeConversationEngine,
}));

import {
  dispatchInbound,
  __resetDispatcherForTesting,
} from '../im-inbound-dispatcher';
import type { InboundMessage } from '@/lib/im';

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: 'm1',
    address: { providerId: 'wechat-qclaw', chatId: 'gid_a', userId: 'u1' },
    text: 'hello bot',
    timestamp: 1700000000,
    ...overrides,
  };
}

beforeEach(() => {
  __resetDispatcherForTesting();
  sendToProvider.mockClear();
  conversationCalls.length = 0;
  conversationResponseText = 'AI reply';
  conversationDelay = null;
  mockBinding = { id: 1, sessionId: 'sess-1', status: 'active' };
});

describe('im-inbound-dispatcher', () => {
  test('happy path: AI reply sent back via sendToProvider', async () => {
    const result = await dispatchInbound('wechat-qclaw', makeMessage());

    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe('sess-1');
    expect(result.replyMessageId).toBe('reply-1');

    expect(conversationCalls).toHaveLength(1);
    expect(conversationCalls[0].sessionId).toBe('sess-1');
    expect(conversationCalls[0].text).toBe('hello bot');
    expect(conversationCalls[0].meta).toEqual({ source: 'wechat-qclaw' });

    expect(sendToProvider).toHaveBeenCalledWith('wechat-qclaw', expect.objectContaining({
      address: { providerId: 'wechat-qclaw', chatId: 'gid_a' },
      text: 'AI reply',
    }));
  });

  test('skips when no binding exists', async () => {
    mockBinding = null;
    const result = await dispatchInbound('wechat-qclaw', makeMessage());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no active binding/);
    expect(conversationCalls).toHaveLength(0);
    expect(sendToProvider).not.toHaveBeenCalled();
  });

  test('skips when binding is inactive', async () => {
    mockBinding = { id: 1, sessionId: 'sess-1', status: 'inactive' };
    const result = await dispatchInbound('wechat-qclaw', makeMessage());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no active binding/);
  });

  test('skips empty text', async () => {
    const result = await dispatchInbound('wechat-qclaw', makeMessage({ text: '   ' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/empty/);
  });

  test('handles empty AI reply gracefully (no send)', async () => {
    conversationResponseText = '';
    const result = await dispatchInbound('wechat-qclaw', makeMessage());
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/empty reply/);
    expect(sendToProvider).not.toHaveBeenCalled();
  });

  test('reflects sendToProvider failure in result', async () => {
    sendToProvider.mockResolvedValueOnce({ ok: false, error: 'network down' });
    const result = await dispatchInbound('wechat-qclaw', makeMessage());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network down');
  });

  test('dedupes concurrent inflight messages', async () => {
    let resolveDelay: (() => void) | null = null;
    conversationDelay = new Promise<void>((resolve) => { resolveDelay = resolve; });

    const msg = makeMessage();
    const first = dispatchInbound('wechat-qclaw', msg);
    const second = dispatchInbound('wechat-qclaw', msg);

    const secondResult = await second;
    expect(secondResult.ok).toBe(false);
    expect(secondResult.reason).toMatch(/duplicate inflight/);

    resolveDelay?.();
    await first;
  });
});
