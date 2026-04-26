import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  createSession: jest.fn(),
  getSession: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}));

// workflow-session.ts pulls getSetting from `@/lib/db/sessions` directly, so
// we must stub that module too — otherwise it falls through to the real
// better-sqlite3 connection during tests.
jest.mock('@/lib/db/sessions', () => ({
  getSetting: jest.fn().mockReturnValue(undefined),
}));

jest.mock('@/lib/db/agent-presets', () => ({
  listAgentPresets: jest.fn().mockReturnValue([]),
}));

jest.mock('@/lib/db/connection', () => ({ dataDir: '/tmp/lumos-test' }));

jest.mock('fs/promises', () => ({ mkdir: jest.fn().mockResolvedValue(undefined) }));

import { createSession, getSession, getSetting, setSetting } from '@/lib/db';
import { GET, POST } from '../route';

const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;
const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;
const mockedSetSetting = setSetting as jest.MockedFunction<typeof setSetting>;

const WORKFLOW_MARKER = '__LUMOS_WORKFLOW_CHAT__';

function makeSession(id: string, withMarker = true): {
  id: string;
  system_prompt: string;
  title: string;
  model: string;
  provider_id: string;
  working_directory: string;
} {
  return {
    id,
    system_prompt: withMarker ? `${WORKFLOW_MARKER}\nrest of prompt` : 'no marker here',
    title: 'workflow chat',
    model: '',
    provider_id: '',
    working_directory: '',
  };
}

describe('workflow chat session route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET — binding lookup', () => {
    test('returns 400 when workflowId missing', async () => {
      const req = new NextRequest('http://localhost/api/workflow/chat/session');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    test('returns null session when no binding exists', async () => {
      mockedGetSetting.mockReturnValue(undefined);
      const req = new NextRequest('http://localhost/api/workflow/chat/session?workflowId=wf-1');
      const res = await GET(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.session).toBeNull();
      expect(mockedGetSetting).toHaveBeenCalledWith('workflow_chat_session:wf-1');
    });

    test('returns the bound session when it exists with marker', async () => {
      mockedGetSetting.mockReturnValue('SID-1');
      mockedGetSession.mockReturnValue(makeSession('SID-1') as never);

      const req = new NextRequest('http://localhost/api/workflow/chat/session?workflowId=wf-1');
      const res = await GET(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.session.id).toBe('SID-1');
      expect(mockedSetSetting).not.toHaveBeenCalled();
    });

    test('clears stale binding when bound session is gone', async () => {
      mockedGetSetting.mockReturnValue('SID-DEAD');
      mockedGetSession.mockReturnValue(undefined);

      const req = new NextRequest('http://localhost/api/workflow/chat/session?workflowId=wf-2');
      const res = await GET(req);
      const body = await res.json();
      expect(body.session).toBeNull();
      expect(mockedSetSetting).toHaveBeenCalledWith('workflow_chat_session:wf-2', '');
    });

    test('clears stale binding when bound session no longer carries the workflow marker', async () => {
      mockedGetSetting.mockReturnValue('SID-DRIFTED');
      mockedGetSession.mockReturnValue(makeSession('SID-DRIFTED', false) as never);

      const req = new NextRequest('http://localhost/api/workflow/chat/session?workflowId=wf-3');
      const res = await GET(req);
      const body = await res.json();
      expect(body.session).toBeNull();
      expect(mockedSetSetting).toHaveBeenCalledWith('workflow_chat_session:wf-3', '');
    });
  });

  describe('POST — create + bind', () => {
    test('creates a session and persists binding under settings', async () => {
      mockedCreateSession.mockReturnValue(makeSession('NEW-SID') as never);

      const req = new NextRequest('http://localhost/api/workflow/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: 'wf-9', workflowDsl: { version: 'v3' } }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.session.id).toBe('NEW-SID');
      expect(mockedSetSetting).toHaveBeenCalledWith('workflow_chat_session:wf-9', 'NEW-SID');
    });

    test('rejects request without workflowId', async () => {
      const req = new NextRequest('http://localhost/api/workflow/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowDsl: {} }),
      });
      const res = await POST(req);
      expect(res.status).toBe(500); // zod parse throws -> caught -> 500
      expect(mockedCreateSession).not.toHaveBeenCalled();
      expect(mockedSetSetting).not.toHaveBeenCalled();
    });
  });
});
