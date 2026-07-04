import { NextRequest } from 'next/server';

const mockMkdir = jest.fn();
const mockCreateSession = jest.fn();
const mockGetSession = jest.fn();
const mockUpdateSdkSessionId = jest.fn();
const mockUpdateSessionSystemPrompt = jest.fn();

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

import { ECOMMERCE_ASSISTANT_CHAT_TITLE } from '@/lib/chat/ecommerce-assistant-session';
import { POST } from '../route';

describe('ecommerce chat session route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSession.mockReturnValue({
      id: 'session-1',
      kind: 'ecommerce-assistant',
      title: ECOMMERCE_ASSISTANT_CHAT_TITLE,
      model: '',
      provider_id: '',
      working_directory: '/tmp/lumos-test-data',
      system_prompt: 'ecommerce prompt',
    });
    mockGetSession.mockReturnValue(undefined);
  });

  it('creates a new ecommerce assistant session with the ecommerce-specific system prompt and kind', async () => {
    const res = await POST(makeReq());
    const json = (await res.json()) as { session: { id: string } };

    expect(res.status).toBe(201);
    expect(json.session.id).toBe('session-1');
    expect(mockMkdir).toHaveBeenCalledWith('/tmp/lumos-test-data', { recursive: true });
    // 身份现在通过第 8 个位置参数 kind='ecommerce-assistant' 声明，不再往 system_prompt 塞 marker。
    expect(mockCreateSession).toHaveBeenCalledWith(
      ECOMMERCE_ASSISTANT_CHAT_TITLE,
      '',
      expect.stringContaining('工坊'),
      '/tmp/lumos-test-data',
      'code',
      undefined,
      undefined,
      'ecommerce-assistant',
    );
    const promptArg = mockCreateSession.mock.calls[0]?.[2] as string;
    expect(promptArg).toContain('Ecommerce Assistant');
    expect(promptArg).toContain('工坊');
    expect(promptArg).toContain('资料库');
  });

  it('reuses an existing ecommerce assistant session and refreshes a changed prompt', async () => {
    mockGetSession
      .mockReturnValueOnce({
        id: 'session-1',
        kind: 'ecommerce-assistant',
        title: ECOMMERCE_ASSISTANT_CHAT_TITLE,
        model: '',
        provider_id: '',
        working_directory: '/tmp/lumos-test-data',
        system_prompt: '旧提示词',
      })
      .mockReturnValueOnce({
        id: 'session-1',
        kind: 'ecommerce-assistant',
        title: ECOMMERCE_ASSISTANT_CHAT_TITLE,
        model: '',
        provider_id: '',
        working_directory: '/tmp/lumos-test-data',
        system_prompt: 'refreshed',
      });

    const res = await POST(makeReq({ session_id: 'session-1' }));
    const json = (await res.json()) as {
      reused: boolean;
      promptRefreshed: boolean;
      session: { id: string };
    };

    expect(res.status).toBe(200);
    expect(json.session.id).toBe('session-1');
    expect(json.reused).toBe(true);
    expect(json.promptRefreshed).toBe(true);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockUpdateSessionSystemPrompt).toHaveBeenCalledWith(
      'session-1',
      expect.stringContaining('工坊'),
    );
    expect(mockUpdateSdkSessionId).toHaveBeenCalledWith('session-1', '');
  });

  it('does not reuse a session of a different kind (e.g. a wechat session)', async () => {
    mockGetSession.mockReturnValueOnce({
      id: 'session-other',
      kind: 'wechat-assistant',
      title: '其他会话',
      model: '',
      provider_id: '',
      working_directory: '/tmp/lumos-test-data',
      system_prompt: 'whatever',
    });

    const res = await POST(makeReq({ session_id: 'session-other' }));

    expect(res.status).toBe(201);
    expect(mockCreateSession).toHaveBeenCalled();
    expect(mockUpdateSessionSystemPrompt).not.toHaveBeenCalled();
  });
});

function makeReq(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/ecommerce/chat/session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
