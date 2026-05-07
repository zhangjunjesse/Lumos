import { NextRequest } from 'next/server';

const mockMkdir = jest.fn();
const mockCreateSession = jest.fn();
const mockGetSession = jest.fn();
const mockUpdateSdkSessionId = jest.fn();
const mockUpdateSessionSystemPrompt = jest.fn();
const mockGetWeChatAssistantSettings = jest.fn();

jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
  },
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

jest.mock('@/lib/db', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  updateSdkSessionId: (...args: unknown[]) => mockUpdateSdkSessionId(...args),
  updateSessionSystemPrompt: (...args: unknown[]) => mockUpdateSessionSystemPrompt(...args),
}));

jest.mock('@/lib/db/connection', () => ({
  dataDir: '/tmp/lumos-test-data',
}));

jest.mock('@/lib/wechat-assistant/settings-store', () => ({
  getWeChatAssistantSettings: () => mockGetWeChatAssistantSettings(),
}));

import {
  WECHAT_ASSISTANT_CHAT_MARKER,
  WECHAT_ASSISTANT_CHAT_TITLE,
} from '@/lib/chat/wechat-assistant-session';
import { POST } from '../route';

describe('wechat chat session route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetWeChatAssistantSettings.mockReturnValue({
      ai: { prompts: { assistantChat: '自定义微信助手提示词' } },
    });
    mockCreateSession.mockReturnValue({
      id: 'session-1',
      title: WECHAT_ASSISTANT_CHAT_TITLE,
      model: '',
      provider_id: '',
      working_directory: '/tmp/lumos-test-data',
      system_prompt: WECHAT_ASSISTANT_CHAT_MARKER,
    });
    mockGetSession.mockReturnValue(undefined);
  });

  it('creates a reusable ChatView-compatible WeChat assistant session on the global chat provider path', async () => {
    const res = await POST(makeReq());
    const json = (await res.json()) as { session: { id: string } };

    expect(res.status).toBe(201);
    expect(json.session.id).toBe('session-1');
    expect(mockMkdir).toHaveBeenCalledWith('/tmp/lumos-test-data', { recursive: true });
    expect(mockCreateSession).toHaveBeenCalledWith(
      WECHAT_ASSISTANT_CHAT_TITLE,
      '',
      expect.stringContaining('自定义微信助手提示词'),
      '/tmp/lumos-test-data',
      'code',
    );
    expect(mockCreateSession.mock.calls[0]?.[2]).toContain(WECHAT_ASSISTANT_CHAT_MARKER);
  });

  it('reuses an existing WeChat assistant session and refreshes changed prompt', async () => {
    mockGetSession
      .mockReturnValueOnce({
        id: 'session-1',
        title: WECHAT_ASSISTANT_CHAT_TITLE,
        model: '',
        provider_id: '',
        working_directory: '/tmp/lumos-test-data',
        system_prompt: WECHAT_ASSISTANT_CHAT_MARKER + '\n旧提示词',
      })
      .mockReturnValueOnce({
        id: 'session-1',
        title: WECHAT_ASSISTANT_CHAT_TITLE,
        model: '',
        provider_id: '',
        working_directory: '/tmp/lumos-test-data',
        system_prompt: WECHAT_ASSISTANT_CHAT_MARKER + '\n自定义微信助手提示词',
      });

    const res = await POST(makeReq({ session_id: 'session-1' }));
    const json = (await res.json()) as { reused: boolean; promptRefreshed: boolean; session: { id: string } };

    expect(res.status).toBe(200);
    expect(json.session.id).toBe('session-1');
    expect(json.reused).toBe(true);
    expect(json.promptRefreshed).toBe(true);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockUpdateSessionSystemPrompt).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining('自定义微信助手提示词'),
    );
    expect(mockUpdateSdkSessionId).toHaveBeenCalledWith('session-1', '');
  });
});

function makeReq(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/wechat/chat/session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
