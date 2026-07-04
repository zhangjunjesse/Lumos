import fs from 'fs';
import os from 'os';
import path from 'path';

// 嵌入器：默认抛错（与 runtime.test.ts 同 pattern，证明 archive 在 embed 不可用时不崩）。
// 需要时调 programEmbeddings 注入固定向量，验证写入路径 + embedded 计数。
jest.mock('@/lib/knowledge/embedder', () => {
  const actual = jest.requireActual('@/lib/knowledge/embedder');
  return {
    ...actual,
    getEmbeddings: jest.fn(async () => { throw new Error('embedder disabled in tests'); }),
    embedQuery: jest.fn(async () => { throw new Error('embedder disabled in tests'); }),
  };
});

async function programEmbeddings(vec: number[]): Promise<void> {
  const emb = await import('@/lib/knowledge/embedder');
  (emb.getEmbeddings as jest.Mock).mockImplementation(async (texts: string[]) => texts.map(() => vec));
}

async function seedMainAgentSession(opts: {
  createdAt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const { createSession, addMessage } = await import('@/lib/db');
  const session = createSession(
    'main-agent-test',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'main-agent',
  );
  const { getDb } = await import('@/lib/db/connection');
  getDb()
    .prepare('UPDATE chat_sessions SET created_at = ?, updated_at = ? WHERE id = ?')
    .run(opts.createdAt, opts.createdAt, session.id);
  for (const m of opts.messages) {
    const content = JSON.stringify([{ type: 'text', text: m.content }]);
    addMessage(session.id, m.role, content);
  }
  return session.id;
}

describe('main-agent-archive', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-archive-'));
    delete process.env.LUMOS_DATA_DIR;
    process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
    jest.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import('@/lib/db/connection');
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_GUI_DATA_DIR;
    jest.resetModules();
  });

  it('skips when day has no main agent sessions', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');

    const { archiveMainAgentChatForDay } = await import('../main-agent-archive');
    const result = await archiveMainAgentChatForDay('2020-01-01');
    expect(result.skipped).toBe(true);
    expect(result.chunks).toBe(0);
    expect(result.embedded).toBe(0);
  });

  it('creates entries with embedding when day has messages', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');
    await programEmbeddings([0.1, 0.2, 0.3]);

    await seedMainAgentSession({
      createdAt: '2020-01-01 12:00:00',
      messages: [
        { role: 'user', content: '帮我看看天气' },
        { role: 'assistant', content: '今天上海晴' },
      ],
    });

    const { archiveMainAgentChatForDay } = await import('../main-agent-archive');
    const result = await archiveMainAgentChatForDay('2020-01-01');
    expect(result.skipped).toBe(false);
    expect(result.sessionCount).toBe(1);
    expect(result.messageCount).toBe(2);
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.embedded).toBe(result.chunks);

    const { listMemoryV2Entries } = await import('../store');
    const entries = listMemoryV2Entries({
      scopeType: 'main_agent',
      ownerModule: 'main_agent_archive',
      limit: 50,
    });
    expect(entries.length).toBe(result.chunks);
    expect(entries[0].embedding).not.toBeNull();
    expect(entries[0].body).toMatch(/用户|助手/);
    expect(entries[0].source_type).toBe('daily_chat');
    expect(entries[0].source_id).toMatch(/^2020-01-01#\d{3}$/);
  });

  it('is idempotent: re-running same day updates existing entries (not duplicates)', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');
    await programEmbeddings([0.1, 0.2, 0.3]);

    await seedMainAgentSession({
      createdAt: '2020-01-01 12:00:00',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const { archiveMainAgentChatForDay } = await import('../main-agent-archive');
    const { listMemoryV2Entries } = await import('../store');

    await archiveMainAgentChatForDay('2020-01-01');
    const first = listMemoryV2Entries({
      scopeType: 'main_agent',
      ownerModule: 'main_agent_archive',
      limit: 50,
    });

    await archiveMainAgentChatForDay('2020-01-01');
    const second = listMemoryV2Entries({
      scopeType: 'main_agent',
      ownerModule: 'main_agent_archive',
      limit: 50,
    });

    expect(second.length).toBe(first.length);
    expect(second.map((e) => e.source_id).sort()).toEqual(first.map((e) => e.source_id).sort());
    expect(second.map((e) => e.id).sort()).toEqual(first.map((e) => e.id).sort());
  });

  it('still writes entries when embedder is disabled, recording embedded=0', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');

    await seedMainAgentSession({
      createdAt: '2020-01-01 12:00:00',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const { archiveMainAgentChatForDay } = await import('../main-agent-archive');
    const result = await archiveMainAgentChatForDay('2020-01-01');
    expect(result.skipped).toBe(false);
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.embedded).toBe(0);

    const { listMemoryV2Entries } = await import('../store');
    const entries = listMemoryV2Entries({
      scopeType: 'main_agent',
      ownerModule: 'main_agent_archive',
      limit: 50,
    });
    expect(entries.length).toBe(result.chunks);
    expect(entries[0].embedding).toBeNull();
  });

  it('splits transcripts into multiple chunks when above CHUNK_TARGET_CHARS', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');
    await programEmbeddings([0.1, 0.2, 0.3]);

    const longText = 'a'.repeat(500);
    await seedMainAgentSession({
      createdAt: '2020-01-01 12:00:00',
      messages: [
        { role: 'user', content: longText },
        { role: 'assistant', content: longText },
        { role: 'user', content: longText },
      ],
    });

    const { archiveMainAgentChatForDay } = await import('../main-agent-archive');
    const result = await archiveMainAgentChatForDay('2020-01-01');
    expect(result.chunks).toBeGreaterThan(1);
  });

  it('archivePreviousMainAgentDay skips when only today has a session', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');
    await programEmbeddings([0.1, 0.2, 0.3]);

    // 用当前 UTC 时间种子一条 session ⇒ sessionDayKey 等于 currentMainAgentDayKey ⇒ 不在"昨天"集合里
    const nowSql = new Date().toISOString().replace('T', ' ').split('.')[0];
    await seedMainAgentSession({
      createdAt: nowSql,
      messages: [{ role: 'user', content: 'today only' }],
    });

    const { archivePreviousMainAgentDay } = await import('../main-agent-archive');
    const result = await archivePreviousMainAgentDay();
    expect(result.skipped).toBe(true);
  });
});
