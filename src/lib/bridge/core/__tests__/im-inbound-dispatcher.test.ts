// Mock heavy transitive imports at the dispatcher boundary so jest doesn't try
// to load @anthropic-ai/claude-agent-sdk and other ESM deps.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sendToProvider = jest.fn(async () => ({ ok: true, messageId: 'reply-1' }));

const mockGetDefaultProvider = jest.fn((): unknown => undefined);
jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: () => mockGetDefaultProvider(),
}));

const mockParseProviderExtraEnv = jest.fn(() => ({}));
const mockResolveProviderRequestApiKey = jest.fn(() => '');
jest.mock('@/lib/provider-model-discovery', () => ({
  parseProviderExtraEnv: (raw: string | undefined) => mockParseProviderExtraEnv(raw),
  resolveProviderRequestApiKey: (provider: unknown) => mockResolveProviderRequestApiKey(provider),
}));

const mockResolveProviderModelForRequest = jest.fn(() => undefined);
jest.mock('@/lib/model-metadata', () => ({
  resolveProviderModelForRequest: (provider: unknown, model?: string | null) =>
    mockResolveProviderModelForRequest(provider, model),
}));

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
  parseSlashCommand: (text: string) => {
    const m = /^\s*\/(\S+)(?:\s+([\s\S]*))?$/.exec(text || '');
    if (!m) return null;
    const name = m[1].toLowerCase();
    const argText = (m[2] ?? '').trim();
    return { name, args: argText ? argText.split(/\s+/) : [], raw: text.trim() };
  },
}));

// Wechat command handler mock — returns handled=false so all wechat tests
// fall through to the AI dispatch path. Per-test can override via the
// jest.requireMock pattern if needed.
jest.mock('@/lib/im/providers/wechat/commands', () => ({
  handleWechatCommand: jest.fn(async () => ({ handled: false })),
  maybeHandleWechatVoiceModePhrase: jest.fn(() => null),
}));

// In-memory mocks for db + wechat route-pointer (used by wechat path)
interface MockMainAgentSession {
  id: string;
  title: string;
  system_prompt?: string;
  created_at?: string;
  status?: 'active' | 'archived';
}
const fakeSessions = new Map<string, MockMainAgentSession>();
let createSessionCounter = 0;
let routePointer: string | null = null;
function nowSqlUtc(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

jest.mock('@/lib/db', () => ({
  getSession: (id: string) => fakeSessions.get(id),
  getAllSessions: () => Array.from(fakeSessions.values()),
  getSetting: () => undefined,
  createSession: (
    _title?: string,
    _model?: string,
    systemPrompt?: string,
  ) => {
    createSessionCounter += 1;
    const id = `auto_${createSessionCounter}`;
    const session: MockMainAgentSession = {
      id,
      title: 'New Chat',
      system_prompt: systemPrompt || '',
      created_at: nowSqlUtc(),
      status: 'active',
    };
    fakeSessions.set(id, session);
    return session;
  },
  updateSessionStatus: (id: string, status: 'active' | 'archived') => {
    const target = fakeSessions.get(id);
    if (target) target.status = status;
  },
}));

jest.mock('@/lib/chat/session-entry', () => ({
  isMainAgentSession: (s: { system_prompt?: string }) =>
    String(s?.system_prompt || '').includes('__LUMOS_MAIN_AGENT__'),
  withSessionEntryMarker: (prompt: string | undefined, entry: string) =>
    entry === 'main-agent'
      ? `__LUMOS_MAIN_AGENT__\n${prompt || ''}`.trim()
      : prompt || '',
}));

jest.mock('@/lib/im/providers/wechat/route-pointer', () => ({
  getCurrentRoutedSessionId: () => routePointer,
  setCurrentRoutedSessionId: (id: string) => {
    routePointer = id;
  },
}));

let voiceModeEnabled = false;
let nativeVoiceReplyEnabled = true;
jest.mock('@/lib/im/providers/wechat/voice-mode', () => ({
  isWechatVoiceModeEnabled: () => voiceModeEnabled,
  isWechatNativeVoiceReplyEnabled: () => nativeVoiceReplyEnabled,
}));

const speechAttachment = {
  id: 'tts-1',
  name: 'tts-1.wav',
  type: 'audio/wav',
  size: 123,
  data: 'UklGRg==',
};
const synthesizeSpeechAttachment = jest.fn(async () => ({
  ok: true,
  attachment: speechAttachment,
}));
const mockResolveExplicitAsrProviderTarget = jest.fn(() => null);
const mockTranscribeAudioAttachmentWithTarget = jest.fn(async () => '');
const mockTranscribeAudioAttachment = jest.fn(async () => ({
  text: '',
  empty: true,
  provider: 'mock',
}));
class MockSpeechProviderNotConfiguredError extends Error {}
jest.mock('@/lib/im/core/speech', () => ({
  SpeechProviderNotConfiguredError: MockSpeechProviderNotConfiguredError,
  normalizeOpenAIBaseUrl: (value: string) => value.trim().replace(/\/+$/, ''),
  resolveExplicitAsrProviderTarget: () => mockResolveExplicitAsrProviderTarget(),
  synthesizeSpeechAttachment: (text: string) => synthesizeSpeechAttachment(text),
  transcribeAudioAttachment: (attachment: unknown) =>
    mockTranscribeAudioAttachment(attachment),
  transcribeAudioAttachmentWithTarget: (attachment: unknown, target: unknown) =>
    mockTranscribeAudioAttachmentWithTarget(attachment, target),
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

interface RecordedAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

const conversationCalls: Array<{
  sessionId: string;
  text: string;
  meta: unknown;
  files: RecordedAttachment[] | undefined;
}> = [];
let conversationResponseText = 'AI reply';
let conversationDelay: Promise<void> | null = null;
let conversationStreamChunks: string[] = [];

class FakeConversationEngine {
  async sendMessage(
    sessionId: string,
    text: string,
    files?: Array<{ id: string; name: string; type: string; size: number }>,
    meta?: { source?: string },
    callbacks?: { onVisibleText?: (chunk: string) => void },
  ) {
    if (conversationDelay) await conversationDelay;
    conversationCalls.push({
      sessionId,
      text,
      meta,
      files: files?.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size })),
    });
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
  const commands = jest.requireMock('@/lib/im/providers/wechat/commands') as {
    handleWechatCommand: jest.Mock;
    maybeHandleWechatVoiceModePhrase: jest.Mock;
  };
  commands.handleWechatCommand.mockReset();
  commands.handleWechatCommand.mockResolvedValue({ handled: false });
  commands.maybeHandleWechatVoiceModePhrase.mockReset();
  commands.maybeHandleWechatVoiceModePhrase.mockReturnValue(null);
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
  voiceModeEnabled = false;
  nativeVoiceReplyEnabled = true;
  synthesizeSpeechAttachment.mockClear();
  synthesizeSpeechAttachment.mockResolvedValue({
    ok: true,
    attachment: speechAttachment,
  });
  mockGetDefaultProvider.mockReset();
  mockGetDefaultProvider.mockReturnValue(undefined);
  mockParseProviderExtraEnv.mockReset();
  mockParseProviderExtraEnv.mockReturnValue({});
  mockResolveProviderRequestApiKey.mockReset();
  mockResolveProviderRequestApiKey.mockReturnValue('');
  mockResolveProviderModelForRequest.mockReset();
  mockResolveProviderModelForRequest.mockReturnValue(undefined);
  mockResolveExplicitAsrProviderTarget.mockReset();
  mockResolveExplicitAsrProviderTarget.mockReturnValue(null);
  mockTranscribeAudioAttachmentWithTarget.mockReset();
  mockTranscribeAudioAttachmentWithTarget.mockResolvedValue('');
  mockTranscribeAudioAttachment.mockReset();
  mockTranscribeAudioAttachment.mockResolvedValue({
    text: '',
    empty: true,
    provider: 'mock',
  });
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
    expect(conversationCalls[0].meta).toEqual({
      source: 'wechat-qclaw',
      imContext: { providerId: 'wechat-qclaw', chatId: 'gid_a' },
    });

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

  describe('wechat path: fixed Main Agent entry', () => {
    function wechatMsg(text = 'hello bot'): Parameters<typeof dispatchInbound>[1] {
      return {
        messageId: `wmsg-${Date.now()}-${Math.random()}`,
        address: { providerId: 'wechat', chatId: 'peer1', userId: 'peer1' },
        text,
        timestamp: 1700000000,
      };
    }

    test('empty main agent → auto-creates main agent session and aligns legacy pointer', async () => {
      conversationResponseText = 'hi from AI';
      const r = await dispatchInbound('wechat', wechatMsg());
      expect(r.ok).toBe(true);
      expect(r.sessionId).toBe('auto_1');
      expect(routePointer).toBe('auto_1');
      expect(fakeSessions.has('auto_1')).toBe(true);
      expect(fakeSessions.get('auto_1')?.system_prompt).toContain('__LUMOS_MAIN_AGENT__');

      const sentArgs = sendToProvider.mock.calls[0][1] as { text: string };
      expect(sentArgs.text).toBe('hi from AI');
    });

    test('ignores legacy pointer to a normal session and uses existing main agent', async () => {
      fakeSessions.set('preset_1', { id: 'preset_1', title: '项目脑暴' });
      fakeSessions.set('main_1', {
        id: 'main_1',
        title: 'Lumos 主 Agent',
        system_prompt: '__LUMOS_MAIN_AGENT__',
        created_at: nowSqlUtc(),
        status: 'active',
      });
      routePointer = 'preset_1';

      const r = await dispatchInbound('wechat', wechatMsg());
      expect(r.sessionId).toBe('main_1');
      expect(routePointer).toBe('main_1');
      // Should NOT create a new session
      expect(fakeSessions.size).toBe(2);

      const sentArgs = sendToProvider.mock.calls[0][1] as { text: string };
      expect(sentArgs.text).toBe('AI reply');
    });

    test('forwards inbound image attachments to conversationEngine', async () => {
      fakeSessions.set('preset_2', { id: 'preset_2', title: 'photo chat' });
      routePointer = 'preset_2';

      const msg = {
        ...wechatMsg(),
        text: '看下这张图',
        attachments: [
          { id: 'wechat-image-100-0', name: 'wechat-image-100-0.jpg', type: 'image/jpeg', size: 12, data: 'AAA=' },
        ],
      };
      await dispatchInbound('wechat', msg);

      expect(conversationCalls).toHaveLength(1);
      expect(conversationCalls[0].files).toEqual([
        { id: 'wechat-image-100-0', name: 'wechat-image-100-0.jpg', type: 'image/jpeg', size: 12 },
      ]);
    });

    test('uses Lumos speech provider fallback for voice placeholder before AI dispatch', async () => {
      mockGetDefaultProvider.mockReturnValue({
        id: 'provider-openai',
        name: 'OpenAI Compatible',
        api_protocol: 'openai-compatible',
        auth_mode: 'api_key',
        base_url: 'https://asr.example/v1',
        api_key: 'stored-key',
        extra_env: JSON.stringify({ OPENAI_ASR_MODEL: 'whisper-test' }),
      });
      mockParseProviderExtraEnv.mockReturnValue({ OPENAI_ASR_MODEL: 'whisper-test' });
      mockResolveProviderRequestApiKey.mockReturnValue('asr-key');
      mockTranscribeAudioAttachment.mockResolvedValueOnce({
        text: '帮我总结一下今天的安排',
        empty: false,
        provider: 'volcengine-asr-v2',
      });

      fakeSessions.set('preset_3', { id: 'preset_3', title: 'voice chat' });
      routePointer = 'preset_3';

      await dispatchInbound('wechat', {
        ...wechatMsg('[语音: wechat-voice-100-0.wav，未收到微信转写文本]'),
        attachments: [
          {
            id: 'wechat-voice-100-0',
            name: 'wechat-voice-100-0.wav',
            type: 'audio/wav',
            size: 8,
            data: Buffer.from('RIFFxxxx').toString('base64'),
          },
        ],
      });

      expect(mockTranscribeAudioAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'wechat-voice-100-0.wav' }),
      );
      expect(conversationCalls).toHaveLength(1);
      expect(conversationCalls[0].text).toBe('帮我总结一下今天的安排');
      expect(conversationCalls[0].files).toBeUndefined();
    });

    test('wechat reply is a single send (no streaming)', async () => {
      const r = await dispatchInbound('wechat', wechatMsg());
      expect(r.ok).toBe(true);
      expect(sendToProvider).toHaveBeenCalledTimes(1);
    });

    test('passes inbound context_token to WeChat reply send', async () => {
      const r = await dispatchInbound('wechat', {
        ...wechatMsg(),
        raw: { context_token: 'ctx-from-current-message' },
      });

      expect(r.ok).toBe(true);
      const sentArgs = sendToProvider.mock.calls[0][1] as {
        providerHints?: { wechat?: { contextToken?: string } };
      };
      expect(sentArgs.providerHints?.wechat?.contextToken).toBe('ctx-from-current-message');
    });

    test('slash command reply reports send failure', async () => {
      const commands = jest.requireMock('@/lib/im/providers/wechat/commands') as {
        handleWechatCommand: jest.Mock;
      };
      commands.handleWechatCommand.mockResolvedValueOnce({
        handled: true,
        reply: {
          address: { providerId: 'wechat', chatId: 'peer1', userId: 'peer1' },
          text: '命令回复',
        },
      });
      sendToProvider.mockResolvedValueOnce({ ok: false, error: 'wechat send failed' });

      const r = await dispatchInbound('wechat', wechatMsg('/help'));

      expect(r.ok).toBe(false);
      expect(r.reason).toBe('wechat send failed');
      expect(conversationCalls).toHaveLength(0);
    });

    test('voice mode sends synthesized audio attachment instead of text reply', async () => {
      voiceModeEnabled = true;
      conversationResponseText = '这是一段语音回复';

      const r = await dispatchInbound('wechat', wechatMsg());

      expect(r.ok).toBe(true);
      expect(synthesizeSpeechAttachment).toHaveBeenCalledWith('这是一段语音回复');
      expect(sendToProvider).toHaveBeenCalledWith('wechat', expect.objectContaining({
        address: { providerId: 'wechat', chatId: 'peer1' },
        text: '',
        attachments: [
          expect.objectContaining({
            id: speechAttachment.id,
            providerHints: { wechat: { nativeVoice: true } },
          }),
        ],
      }));
    });

    test('voice mode falls back to text when speech synthesis fails', async () => {
      voiceModeEnabled = true;
      synthesizeSpeechAttachment.mockResolvedValueOnce({ ok: false, error: 'tts unavailable' });
      conversationResponseText = 'hi from AI';

      const r = await dispatchInbound('wechat', wechatMsg());

      expect(r.ok).toBe(true);
      const sentArgs = sendToProvider.mock.calls[0][1] as { text: string };
      expect(sentArgs.text).toBe('hi from AI');
    });

    test('voice mode does not resend inline attachments when voice send falls back to text', async () => {
      voiceModeEnabled = true;
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-im-dispatcher-'));
      const mediaDir = path.join(tempRoot, '.lumos-media');
      fs.mkdirSync(mediaDir, { recursive: true });
      const imagePath = path.join(mediaDir, 'reply.png');
      fs.writeFileSync(imagePath, Buffer.from('fake image bytes'));
      conversationResponseText = `这里是图片\n![图](${imagePath})`;
      sendToProvider
        .mockResolvedValueOnce({ ok: true, messageId: 'media-1' })
        .mockResolvedValueOnce({ ok: false, error: 'voice send failed' })
        .mockResolvedValueOnce({ ok: true, messageId: 'text-1' });

      try {
        const r = await dispatchInbound('wechat', wechatMsg());
        expect(r.ok).toBe(true);
        expect(r.replyMessageId).toBe('text-1');
        expect(sendToProvider).toHaveBeenCalledTimes(3);

        const mediaSend = sendToProvider.mock.calls[0][1] as { text: string; attachments?: Array<{ name: string }> };
        expect(mediaSend.text).toBe('');
        expect(mediaSend.attachments).toHaveLength(1);
        expect(mediaSend.attachments?.[0].name).toBe('reply.png');

        const voiceSend = sendToProvider.mock.calls[1][1] as { text: string; attachments?: Array<{ id: string }> };
        expect(voiceSend.text).toBe('');
        expect(voiceSend.attachments).toEqual([
          expect.objectContaining({
            id: speechAttachment.id,
            providerHints: { wechat: { nativeVoice: true } },
          }),
        ]);

        const fallbackSend = sendToProvider.mock.calls[2][1] as { text: string; attachments?: unknown[] };
        expect(fallbackSend.text).toMatch(/这里是图片/);
        expect(fallbackSend.attachments).toBeUndefined();
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    test('spoken voice-mode phrase is handled before AI dispatch', async () => {
      const commands = jest.requireMock('@/lib/im/providers/wechat/commands') as {
        maybeHandleWechatVoiceModePhrase: jest.Mock;
      };
      commands.maybeHandleWechatVoiceModePhrase.mockReturnValueOnce({
        handled: true,
        reply: {
          address: { providerId: 'wechat', chatId: 'peer1', userId: 'peer1' },
          text: '✓ 已切到语音模式。',
        },
      });

      const r = await dispatchInbound('wechat', wechatMsg('开启语音模式'));

      expect(r.ok).toBe(true);
      expect(r.reason).toBe('voice-mode-command-handled');
      expect(conversationCalls).toHaveLength(0);
      expect(sendToProvider).toHaveBeenCalledWith('wechat', expect.objectContaining({
        text: '✓ 已切到语音模式。',
      }));
    });
  });
});
