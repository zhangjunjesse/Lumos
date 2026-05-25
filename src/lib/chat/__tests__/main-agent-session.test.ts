import fs from 'fs';
import os from 'os';
import path from 'path';

describe('main-agent-session rollover', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-main-agent-'));
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

  // 直接改 chat_sessions.created_at 模拟"昨天的 session"，避免 mock 时钟。
  async function backdateSession(id: string, sqlTime: string): Promise<void> {
    const { getDb } = await import('@/lib/db/connection');
    getDb().prepare('UPDATE chat_sessions SET created_at = ?, updated_at = ? WHERE id = ?').run(sqlTime, sqlTime, id);
  }

  it('creates today session when nothing exists and titles it as YYYY-MM-DD', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');

    const { resolveMainAgentSession, currentMainAgentDayKey } = await import('../main-agent-session');
    const created = resolveMainAgentSession({ createIfMissing: true });
    expect(created).not.toBeNull();
    expect(created!.title).toBe(currentMainAgentDayKey());
    expect(created!.status).toBe('active');
  });

  it('returns same session when called twice on the same day', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');

    const { resolveMainAgentSession } = await import('../main-agent-session');
    const first = resolveMainAgentSession({ createIfMissing: true });
    const second = resolveMainAgentSession({ createIfMissing: true });
    expect(second?.id).toBe(first?.id);
  });

  it('archives yesterday session and creates today session on rollover', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');

    const { resolveMainAgentSession, currentMainAgentDayKey } = await import('../main-agent-session');
    const { getSession } = await import('@/lib/db');
    const today = currentMainAgentDayKey();

    // 第一次建当日 session，然后回填到 5 天前模拟"过了 5 天没切日"。
    const old = resolveMainAgentSession({ createIfMissing: true })!;
    await backdateSession(old.id, '2020-01-01 12:00:00');

    const fresh = resolveMainAgentSession({ createIfMissing: true })!;
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.title).toBe(today);
    expect(fresh.status).toBe('active');

    const archived = getSession(old.id);
    expect(archived?.status).toBe('archived');
  });

  it('returns null when createIfMissing is false and no today session exists', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');

    const { resolveMainAgentSession } = await import('../main-agent-session');
    const session = resolveMainAgentSession();
    expect(session).toBeNull();
  });

  it('lists main agent sessions including archived ones', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');

    const { resolveMainAgentSession, listMainAgentSessions } = await import('../main-agent-session');
    const old = resolveMainAgentSession({ createIfMissing: true })!;
    await backdateSession(old.id, '2020-01-01 12:00:00');
    resolveMainAgentSession({ createIfMissing: true });

    const list = listMainAgentSessions(10);
    expect(list.length).toBe(2);
    expect(list.some((s) => s.id === old.id)).toBe(true);
  });

  it('uses sleep_time shift so 02:00 still belongs to the previous day', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('memory_v2_sleep_time', '03:30');
    setSetting('memory_v2_sleep_timezone', 'Asia/Shanghai');

    const { sessionDayKey, currentMainAgentDayKey } = await import('../main-agent-session');
    // 在上海时区 5/20 02:00 = UTC 5/19 18:00。按 sleep_time=03:30 偏移后属于"5/19"。
    expect(sessionDayKey('2026-05-19 18:00:00')).toBe('2026-05-19');
    // 上海 5/20 04:00 = UTC 5/19 20:00 → 偏移后属于 5/20。
    expect(sessionDayKey('2026-05-19 20:00:00')).toBe('2026-05-20');

    // currentMainAgentDayKey 只依赖系统时钟，不强测，但确保返回 YYYY-MM-DD 形态。
    expect(currentMainAgentDayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
