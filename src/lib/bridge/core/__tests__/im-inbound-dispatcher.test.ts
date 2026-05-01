// Mock heavy transitive imports at the dispatcher boundary so jest doesn't try
// to load @anthropic-ai/claude-agent-sdk and other ESM deps.

const sendToProvider = jest.fn(async () => ({ ok: true, messageId: 'reply-1' }));

// Streaming-preview-capable fake adapter, switched on per-test
const previewAdapter = {
  startPreview: jest.fn(async () => ({
    providerId: 'feishu',
    cardId: 'card-1',
    address: { providerId: 'feishu', chatId: 'gid_a' },
  })),
  updatePreview: jest.fn(async () => undefined),
  finalizePreview: jest.fn(async () => undefined),
};
let streamingEnabled = false;

jest.mock('@/lib/im', () => ({
  sendToProvider: (id: string, msg: unknown) => sendToProvider(id, msg),
  getOrCreateAdapter: () => (streamingEnabled ? previewAdapter : null),
  hasStreamingPreview: (a: unknown) =>
    !!a && typeof (a as { startPreview?: unknown }).startPreview === 'function',
}));

// In-memory mocks for db + wechat route-pointer (used by wechat path)
const fakeSessions = new Map<string, { id: string; title: string }>();
let createSessionCounter = 0;
let routePointer: string | null = null;

jest.mock('@/lib/db', () => ({
  getSession: (id: string) => fakeSessions.get(id),
  createSession: () => {
    createSessionCounter += 1;
    const id = `auto_${createSessionCounter}`;
    const session = { id, title: 'New Chat' };
    fakeSessions.set(id, session);
    return session;
  },
}));

jest.mock('@/lib/im/providers/wechat/route-pointer', () => ({
  getCurrentRoutedSessionId: () => routePointer,
  setCurrentRoutedSessionId: (id: string) => {
    routePointer = id;
  },
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
let conversationStreamChunks: string[] = [];

class FakeConversationEngine {
  async sendMessage(
    sessionId: string,
    text: string,
    _files?: never,
    meta?: { source?: string },
    callbacks?: { onVisibleText?: (chunk: string) => void },
  ) {
    if (conversationDelay) await conversationDelay;
    conversationCalls.push({ sessionId, text, meta });
    if (callbacks?.onVisibleText) {
      for (const chunk of conversationStreamChunks) {
        callbacks.onVisibleText(chunk);
      }
    }
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
  previewAdapter.startPreview.mockClear();
  previewAdapter.updatePreview.mockClear();
  previewAdapter.finalizePreview.mockClear();
  streamingEnabled = false;
  conversationCalls.length = 0;
  conversationResponseText = 'AI reply';
  conversationDelay = null;
  conversationStreamChunks = [];
  mockBinding = { id: 1, sessionId: 'sess-1', status: 'active' };
  fakeSessions.clear();
  createSessionCounter = 0;
  routePointer = null;
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

  describe('streaming preview path', () => {
    test('starts preview, streams chunks, finalizes, no duplicate send', async () => {
      streamingEnabled = true;
      conversationStreamChunks = ['He', 'Hel', 'Hello'];
      conversationResponseText = 'Hello world';

      const result = await dispatchInbound('feishu', makeMessage({
        address: { providerId: 'feishu', chatId: 'gid_a', userId: 'u' },
      }));

      expect(result.ok).toBe(true);
      expect(result.replyMessageId).toBe('card-1');
      expect(previewAdapter.startPreview).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: 'gid_a' }),
        '正在思考...',
      );
      expect(previewAdapter.updatePreview).toHaveBeenCalledTimes(3);
      expect(previewAdapter.finalizePreview).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'card-1' }),
        'Hello world',
      );
      // 流式路径不再调 sendToProvider
      expect(sendToProvider).not.toHaveBeenCalled();
    });

    test('preview start failure falls back to plain send', async () => {
      streamingEnabled = true;
      previewAdapter.startPreview.mockRejectedValueOnce(new Error('init failed'));

      const result = await dispatchInbound('feishu', makeMessage({
        address: { providerId: 'feishu', chatId: 'gid_a' },
      }));
      expect(result.ok).toBe(true);
      expect(sendToProvider).toHaveBeenCalledTimes(1);
      expect(previewAdapter.finalizePreview).not.toHaveBeenCalled();
    });

    test('AI exception finalizes preview with error', async () => {
      streamingEnabled = true;
      // Make conversationEngine throw
      const ce = new FakeConversationEngine();
      ce.sendMessage = jest.fn(async () => { throw new Error('AI down'); });
      // Reach into module to swap the cached fake — easier: trigger via deps param? Not in tests yet.
      // Instead use the global FakeConversationEngine and stub one call:
      const original = FakeConversationEngine.prototype.sendMessage;
      FakeConversationEngine.prototype.sendMessage = jest.fn(async () => {
        throw new Error('AI down');
      });
      try {
        await expect(
          dispatchInbound('feishu', makeMessage({ address: { providerId: 'feishu', chatId: 'gid_a' } })),
        ).rejects.toThrow(/AI down/);
        expect(previewAdapter.finalizePreview).toHaveBeenCalledWith(
          expect.any(Object),
          expect.stringMatching(/❌.*AI down/),
        );
      } finally {
        FakeConversationEngine.prototype.sendMessage = original;
      }
    });
  });

  describe('wechat path: route pointer + auto-create + session prefix', () => {
    function wechatMsg(text = 'hello bot'): Parameters<typeof dispatchInbound>[1] {
      return {
        messageId: `wmsg-${Date.now()}-${Math.random()}`,
        address: { providerId: 'wechat', chatId: 'peer1', userId: 'peer1' },
        text,
        timestamp: 1700000000,
      };
    }

    test('empty pointer → auto-creates session, sets pointer, prefixes reply', async () => {
      conversationResponseText = 'hi from AI';
      const r = await dispatchInbound('wechat', wechatMsg());
      expect(r.ok).toBe(true);
      expect(r.sessionId).toBe('auto_1');
      expect(routePointer).toBe('auto_1');
      expect(fakeSessions.has('auto_1')).toBe(true);

      // Reply text should be prefixed with session title block
      const sentArgs = sendToProvider.mock.calls[0][1] as { text: string };
      expect(sentArgs.text).toMatch(/📂 \(未命名 auto_1\)/);
      expect(sentArgs.text).toMatch(/─────/);
      expect(sentArgs.text).toMatch(/hi from AI/);
    });

    test('reuses pointer when already set', async () => {
      fakeSessions.set('preset_1', { id: 'preset_1', title: '项目脑暴' });
      routePointer = 'preset_1';

      const r = await dispatchInbound('wechat', wechatMsg());
      expect(r.sessionId).toBe('preset_1');
      // Should NOT create a new session
      expect(fakeSessions.size).toBe(1);

      const sentArgs = sendToProvider.mock.calls[0][1] as { text: string };
      expect(sentArgs.text).toMatch(/📂 项目脑暴/);
    });

    test('reply with session prefix is single send (no streaming)', async () => {
      const r = await dispatchInbound('wechat', wechatMsg());
      expect(r.ok).toBe(true);
      expect(sendToProvider).toHaveBeenCalledTimes(1);
    });
  });
});
