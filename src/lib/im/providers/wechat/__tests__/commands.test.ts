// Mock @/lib/db (used by commands.ts) — in-memory session store + setting store.

interface FakeSession {
  id: string;
  title: string;
  status: 'active' | 'archived';
  updated_at: string; // ISO-ish "YYYY-MM-DD HH:mm:ss"
}

const sessionsTable: FakeSession[] = [];
const settings = new Map<string, string>();
let createCounter = 0;

jest.mock('@/lib/db', () => ({
  getAllSessions: () => [...sessionsTable].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  ),
  getSession: (id: string) => sessionsTable.find((s) => s.id === id),
  createSession: (title?: string) => {
    createCounter += 1;
    const id = `sess_${createCounter.toString(16).padStart(6, '0')}`;
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    const session: FakeSession = {
      id,
      title: title || 'New Chat',
      status: 'active',
      updated_at: now,
    };
    sessionsTable.push(session);
    return session;
  },
  getSetting: (k: string) => settings.get(k),
  setSetting: (k: string, v: string) => {
    settings.set(k, v);
  },
}));

import { handleWechatCommand, WECHAT_COMMANDS } from '../commands';
import {
  getCurrentRoutedSessionId,
  setCurrentRoutedSessionId,
} from '../route-pointer';
import type { IMCommandContext } from '../../../core/types';

function makeCtx(command: string, args: string[] = []): IMCommandContext {
  return {
    command,
    args,
    message: {
      messageId: 'm1',
      address: { providerId: 'wechat', chatId: 'peer1', userId: 'peer1' },
      text: `/${command} ${args.join(' ')}`.trim(),
      timestamp: Date.now(),
    },
  };
}

function freshDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().replace('T', ' ').split('.')[0];
}

beforeEach(() => {
  sessionsTable.length = 0;
  settings.clear();
  createCounter = 0;
});

describe('wechat/commands: WECHAT_COMMANDS list', () => {
  test('contains 4 custom + builtin commands', () => {
    const names = WECHAT_COMMANDS.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['list', 'switch', 'current', 'new']));
    expect(names).toEqual(expect.arrayContaining(['help', 'ping', 'whoami']));
  });
});

describe('wechat/commands: /list', () => {
  test('empty state', async () => {
    const r = await handleWechatCommand(makeCtx('list'));
    expect(r.handled).toBe(true);
    expect(r.reply!.text).toMatch(/没有最近 30 天活跃过的会话/);
  });

  test('lists active sessions, marks current', async () => {
    sessionsTable.push(
      { id: 'sess_a1', title: '项目脑暴', status: 'active', updated_at: freshDate(0) },
      { id: 'sess_b2', title: '阅读笔记', status: 'active', updated_at: freshDate(1) },
      { id: 'sess_c3', title: '老的', status: 'active', updated_at: freshDate(40) }, // out of 30d
    );
    setCurrentRoutedSessionId('sess_a1');

    const r = await handleWechatCommand(makeCtx('list'));
    expect(r.reply!.text).toMatch(/项目脑暴/);
    expect(r.reply!.text).toMatch(/阅读笔记/);
    expect(r.reply!.text).not.toMatch(/老的/); // out of cutoff
    expect(r.reply!.text).toMatch(/← 当前/);
  });

  test('archived sessions excluded', async () => {
    sessionsTable.push({
      id: 'sess_x',
      title: '归档',
      status: 'archived',
      updated_at: freshDate(0),
    });
    const r = await handleWechatCommand(makeCtx('list'));
    expect(r.reply!.text).not.toMatch(/归档/);
  });

  test('pagination', async () => {
    for (let i = 0; i < 25; i++) {
      sessionsTable.push({
        id: `sess_${i}`,
        title: `S${i}`,
        status: 'active',
        updated_at: freshDate(i / 24), // each ~1h apart
      });
    }
    const p1 = await handleWechatCommand(makeCtx('list', ['1']));
    expect(p1.reply!.text).toMatch(/第 1 页 \/ 共 3 页/);
    const p3 = await handleWechatCommand(makeCtx('list', ['3']));
    expect(p3.reply!.text).toMatch(/第 3 页 \/ 共 3 页/);
  });
});

describe('wechat/commands: /switch', () => {
  beforeEach(() => {
    sessionsTable.push(
      { id: 'sess_a1', title: '项目脑暴', status: 'active', updated_at: freshDate(0) },
      { id: 'sess_b2', title: '阅读笔记', status: 'active', updated_at: freshDate(1) },
      { id: 'sess_c3', title: '另一个项目脑暴', status: 'active', updated_at: freshDate(2) },
    );
  });

  test('without args shows usage', async () => {
    const r = await handleWechatCommand(makeCtx('switch'));
    expect(r.reply!.text).toMatch(/用法/);
  });

  test('by index', async () => {
    const r = await handleWechatCommand(makeCtx('switch', ['1']));
    expect(r.reply!.text).toMatch(/已切到/);
    expect(getCurrentRoutedSessionId()).toBe('sess_a1');
  });

  test('by short id', async () => {
    const r = await handleWechatCommand(makeCtx('switch', ['sess_b']));
    // short_id is first 6 chars; sess_b is exact for 'sess_b' but short_id is 'sess_b'
    expect(r.reply!.text).toMatch(/已切到/);
    expect(getCurrentRoutedSessionId()).toBe('sess_b2');
  });

  test('by exact name', async () => {
    const r = await handleWechatCommand(makeCtx('switch', ['项目脑暴']));
    expect(getCurrentRoutedSessionId()).toBe('sess_a1');
    expect(r.reply!.text).toMatch(/已切到/);
  });

  test('fuzzy match with multiple results asks for disambiguation', async () => {
    const r = await handleWechatCommand(makeCtx('switch', ['脑暴']));
    expect(getCurrentRoutedSessionId()).toBeNull();
    expect(r.reply!.text).toMatch(/找到多个/);
  });

  test('no match', async () => {
    const r = await handleWechatCommand(makeCtx('switch', ['not-a-thing-xyz']));
    expect(r.reply!.text).toMatch(/没找到/);
    expect(getCurrentRoutedSessionId()).toBeNull();
  });
});

describe('wechat/commands: /current', () => {
  test('no pointer', async () => {
    const r = await handleWechatCommand(makeCtx('current'));
    expect(r.reply!.text).toMatch(/没有路由目标/);
  });

  test('with valid pointer', async () => {
    sessionsTable.push({
      id: 'sess_a1',
      title: '项目脑暴',
      status: 'active',
      updated_at: freshDate(0),
    });
    setCurrentRoutedSessionId('sess_a1');
    const r = await handleWechatCommand(makeCtx('current'));
    expect(r.reply!.text).toMatch(/项目脑暴/);
  });

  test('pointer points to deleted session', async () => {
    setCurrentRoutedSessionId('sess_ghost');
    const r = await handleWechatCommand(makeCtx('current'));
    expect(r.reply!.text).toMatch(/已不存在|没有路由目标/);
  });
});

describe('wechat/commands: /new', () => {
  test('without name creates session and sets pointer', async () => {
    const r = await handleWechatCommand(makeCtx('new'));
    expect(r.handled).toBe(true);
    expect(sessionsTable).toHaveLength(1);
    expect(getCurrentRoutedSessionId()).toBe(sessionsTable[0].id);
    expect(r.reply!.text).toMatch(/新建/);
  });

  test('with name uses name', async () => {
    const r = await handleWechatCommand(makeCtx('new', ['出差', '日报']));
    expect(sessionsTable[0].title).toBe('出差 日报');
    expect(r.reply!.text).toMatch(/出差 日报/);
  });
});

describe('wechat/commands: builtin fallback', () => {
  test('/ping still works', async () => {
    const r = await handleWechatCommand(makeCtx('ping'));
    expect(r.handled).toBe(true);
    expect(r.reply!.text).toBe('pong');
  });

  test('unknown returns handled=false', async () => {
    const r = await handleWechatCommand(makeCtx('nope'));
    expect(r.handled).toBe(false);
  });
});

describe('wechat/commands: /help with custom', () => {
  test('lists custom commands', async () => {
    const r = await handleWechatCommand(makeCtx('help'));
    expect(r.reply!.text).toMatch(/list/);
    expect(r.reply!.text).toMatch(/switch/);
    expect(r.reply!.text).toMatch(/new/);
  });
});
