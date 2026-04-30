const insertedRows: unknown[][] = [];
const fakeStmt = {
  run: jest.fn((...args: unknown[]) => {
    insertedRows.push(args);
    return { changes: 1, lastInsertRowid: 1 };
  }),
};
jest.mock('@/lib/db', () => ({
  getDb: () => ({ prepare: () => fakeStmt }),
}));

const knownProviders = new Set(['wechat-qclaw', 'wechat-work']);
jest.mock('@/lib/im', () => ({
  hasProvider: (id: string) => knownProviders.has(id),
}));

jest.mock('@/lib/bridge/core/im-inbound-dispatcher', () => ({
  dispatchInbound: jest.fn(async () => ({ ok: true })),
}));

let authorized = true;
jest.mock('@/lib/bridge/runtime-auth', () => ({
  isBridgeRuntimeAuthorized: () => authorized,
  bridgeRuntimeUnauthorizedResponse: () =>
    new Response('UNAUTHORIZED', { status: 401 }),
}));

import { POST } from '../ingest/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/im/runtime/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  insertedRows.length = 0;
  fakeStmt.run.mockClear();
  authorized = true;
});

describe('POST /api/im/runtime/ingest', () => {
  test('401 without runtime auth', async () => {
    authorized = false;
    const res = await POST(makeReq({ providerId: 'wechat-qclaw' }));
    expect(res.status).toBe(401);
  });

  test('400 on invalid JSON', async () => {
    const res = await POST(new Request('http://localhost/api/im/runtime/ingest', {
      method: 'POST',
      body: 'not-json',
    }));
    expect(res.status).toBe(400);
  });

  test('400 on unknown provider', async () => {
    const res = await POST(makeReq({
      providerId: 'ghost',
      message: { messageId: 'm1', address: { providerId: 'ghost', chatId: 'c1' }, text: 'hi', timestamp: 1 },
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('UNKNOWN_PROVIDER');
  });

  test('400 on missing message fields', async () => {
    const res = await POST(makeReq({
      providerId: 'wechat-qclaw',
      message: { messageId: 'm', address: {}, text: '', timestamp: 0 },
    }));
    expect(res.status).toBe(400);
  });

  test('persists valid event to bridge_events', async () => {
    const res = await POST(makeReq({
      providerId: 'wechat-qclaw',
      message: {
        messageId: 'qclaw-msg-1',
        address: { providerId: 'wechat-qclaw', chatId: 'gid_123', userId: 'wxid_a' },
        text: 'hello',
        timestamp: 1700000000,
      },
      receivedAt: 1700000001,
    }));
    expect(res.status).toBe(200);
    expect(fakeStmt.run).toHaveBeenCalledTimes(1);
    const args = insertedRows[0];
    expect(args[0]).toMatch(/^im_wechat-qclaw_qclaw-msg-1_/); // event id
    expect(args[1]).toBe('wechat-qclaw'); // platform
    expect(args[2]).toBe('gid_123'); // chat_id
    expect(args[3]).toBe('qclaw-msg-1'); // platform_message_id
    expect(typeof args[4]).toBe('string'); // payload_json
    const payload = JSON.parse(args[4] as string);
    expect(payload.text).toBe('hello');
  });
});
