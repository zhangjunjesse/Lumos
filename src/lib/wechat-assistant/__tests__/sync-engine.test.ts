import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-sync-test-'));

jest.mock('@/lib/db', () => ({
  dataDir: TMP_ROOT,
}));

const mockStreamWeChatApi = jest.fn();
jest.mock('@/lib/wechat-export/api-bridge', () => ({
  streamWeChatApi: mockStreamWeChatApi,
}));

jest.mock('@/lib/wechat-export/disclaimer', () => ({
  hasValidConsent: () => true,
}));

jest.mock('@/lib/wechat-export/setup-state', () => ({
  hasRecoveredKey: () => true,
}));

const originalPlatform = process.platform;
Object.defineProperty(process, 'platform', { value: 'darwin' });

import { closeMirrorDb } from '../mirror-db';
import { getSyncState, querySnapshot, resetMirror } from '../mirror-store';
import { runSync, type SyncProgressEvent } from '../sync-engine';

afterAll(() => {
  closeMirrorDb();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

beforeEach(() => {
  resetMirror();
  mockStreamWeChatApi.mockReset();
});

describe('runSync', () => {
  it('streams meta + msg events into the mirror, advances cursor on success', async () => {
    mockStreamWeChatApi.mockImplementation(async (_op: string, _args: unknown, opts: { onLine: (r: unknown) => void }) => {
      opts.onLine({
        type: 'meta',
        sessions: [
          { wxid: 'alice', display: 'Alice', is_group: false, last_timestamp: 1700000100 },
          { wxid: 'g@chatroom', display: '群', is_group: true, last_timestamp: 1700000200 },
        ],
      });
      opts.onLine({ type: 'db_start', db: 'message_0.db', tables: 2 });
      opts.onLine({ type: 'msg', wxid: 'alice', ts: 1700000100, sender: 'them', msg_type: 1, content: '你好' });
      opts.onLine({ type: 'msg', wxid: 'alice', ts: 1700000050, sender: 'me', msg_type: 1, content: '在' });
      opts.onLine({ type: 'msg', wxid: 'g@chatroom', ts: 1700000200, sender: 'them', msg_type: 1, content: '今晚开会' });
      opts.onLine({ type: 'db_done', db: 'message_0.db', messages: 3 });
      opts.onLine({ type: 'done', cursor: 1700000200, messages: 3 });
      return { ok: true, data: { messagesSeen: 6 } };
    });

    const events: SyncProgressEvent[] = [];
    const result = await runSync({ onEvent: (e) => events.push(e) });

    expect(result.status).toBe('completed');
    expect(result.inserted).toBe(3);
    expect(result.cursorTs).toBe(1700000200);

    const state = getSyncState();
    expect(state.cursorTs).toBe(1700000200);
    expect(state.totalMessages).toBe(3);
    expect(state.lastFinishedAt).toBeGreaterThan(0);
    expect(state.lastError).toBeNull();

    // Events: start, sessions, db_start, progress*, db_done, done
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(types).toContain('sessions');
    expect(types).toContain('db_start');
    expect(types).toContain('db_done');
    expect(types[types.length - 1]).toBe('done');

    // Snapshot query reflects what we just synced.
    const snap = querySnapshot(60, 1700000300);
    expect(snap.sessions).toHaveLength(2);
    expect(snap.messages).toHaveLength(3);
  });

  it('dedupes on subsequent runs via fingerprint', async () => {
    const setup = (opts: { onLine: (r: unknown) => void }) => {
      opts.onLine({ type: 'meta', sessions: [{ wxid: 'alice', display: 'A', is_group: false, last_timestamp: 1000 }] });
      opts.onLine({ type: 'db_start', db: 'm.db', tables: 1 });
      opts.onLine({ type: 'msg', wxid: 'alice', ts: 999, sender: 'them', msg_type: 1, content: 'hello' });
      opts.onLine({ type: 'db_done', db: 'm.db', messages: 1 });
      opts.onLine({ type: 'done', cursor: 999, messages: 1 });
      return { ok: true, data: { messagesSeen: 5 } };
    };
    mockStreamWeChatApi.mockImplementation(async (_op, _args, opts) => setup(opts));

    const r1 = await runSync({});
    expect(r1.inserted).toBe(1);

    mockStreamWeChatApi.mockImplementation(async (_op, _args, opts) => setup(opts));
    const r2 = await runSync({});
    expect(r2.inserted).toBe(0); // already in mirror

    expect(getSyncState().totalMessages).toBe(1);
  });

  it('records lastError and returns failed status when stream errors out', async () => {
    mockStreamWeChatApi.mockImplementation(async () => ({
      ok: false,
      error: { code: 'python_error', message: 'sqlcipher exit 1' },
    }));

    const result = await runSync({});
    expect(result.status).toBe('failed');
    expect(result.error).toContain('sqlcipher');
    expect(getSyncState().lastError).toContain('sqlcipher');
  });

  it('serializes concurrent runs (second call awaits the first)', async () => {
    let resolveStream!: () => void;
    const blocker = new Promise<void>((resolve) => {
      resolveStream = resolve;
    });

    mockStreamWeChatApi.mockImplementation(async (_op, _args, opts) => {
      opts.onLine({ type: 'meta', sessions: [] });
      await blocker;
      opts.onLine({ type: 'done', cursor: 100, messages: 0 });
      return { ok: true, data: { messagesSeen: 2 } };
    });

    const a = runSync({});
    const b = runSync({});
    resolveStream();

    const [ra, rb] = await Promise.all([a, b]);
    // Second call gets the same in-flight promise → identical result.
    expect(ra).toBe(rb);
    expect(mockStreamWeChatApi).toHaveBeenCalledTimes(1);
  });
});
