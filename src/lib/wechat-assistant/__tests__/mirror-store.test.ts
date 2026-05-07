import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-mirror-test-'));

jest.mock('@/lib/db', () => ({
  dataDir: TMP_ROOT,
}));

import { closeMirrorDb } from '../mirror-db';
import {
  filterTopicRangeSummaryByAllowedWxids,
  fingerprintFor,
  getMessageContext,
  getTopicRangeSummary,
  getSyncState,
  insertMessages,
  markSyncFinished,
  markSyncStarted,
  querySnapshot,
  resetMirror,
  saveTopicDailySummary,
  searchMessages,
  setCursor,
  setLastError,
  upsertSessions,
  type TopicRangeSummary,
  type MirrorMessage,
  type MirrorSession,
} from '../mirror-store';

afterAll(() => {
  closeMirrorDb();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  resetMirror();
});

const session = (wxid: string, overrides: Partial<MirrorSession> = {}): MirrorSession => ({
  wxid,
  display: wxid,
  isGroup: false,
  lastTs: 0,
  messageCount: 0,
  unreadCount: 0,
  summary: '',
  ...overrides,
});

const msg = (
  wxid: string,
  ts: number,
  sender: 'me' | 'them',
  content: string,
  msgType = 1,
  senderDisplay?: string,
): MirrorMessage => ({ wxid, ts, sender, content, msgType, senderDisplay });

describe('upsertSessions', () => {
  it('inserts new sessions and merges last_ts/message_count on conflict', () => {
    upsertSessions([session('alice', { lastTs: 100, messageCount: 5 })]);
    upsertSessions([
      session('alice', { lastTs: 50, messageCount: 9, display: 'Alice' }),
    ]);
    const snap = querySnapshot(60, 1000);
    const alice = snap.sessions.find((s) => s.wxid === 'alice')!;
    expect(alice.display).toBe('Alice');
    // last_ts kept as MAX(existing, new) — older incoming did NOT regress it
    expect(alice.last_timestamp).toBe(100);
  });
});

describe('insertMessages', () => {
  it('returns the count of newly inserted rows and dedupes by fingerprint', () => {
    upsertSessions([session('alice', { lastTs: 100 })]);
    const inserted1 = insertMessages([
      msg('alice', 1000, 'me', 'hello'),
      msg('alice', 1001, 'them', 'hi'),
    ]);
    expect(inserted1).toBe(2);

    // Re-insert same rows: should be ignored.
    const inserted2 = insertMessages([
      msg('alice', 1000, 'me', 'hello'),
      msg('alice', 1001, 'them', 'hi'),
    ]);
    expect(inserted2).toBe(0);

    // Same ts/sender but different content → distinct fingerprint, kept.
    const inserted3 = insertMessages([msg('alice', 1000, 'me', 'goodbye')]);
    expect(inserted3).toBe(1);
  });

  it('produces stable fingerprints', () => {
    expect(fingerprintFor('me', 'hello')).toEqual(fingerprintFor('me', 'hello'));
    expect(fingerprintFor('me', 'hello')).not.toEqual(fingerprintFor('them', 'hello'));
    expect(fingerprintFor('me', 'hello')).not.toEqual(fingerprintFor('me', 'goodbye'));
    expect(fingerprintFor('them', 'hello', 'alice')).not.toEqual(fingerprintFor('them', 'hello', 'bob'));
  });
});

describe('querySnapshot', () => {
  it('only returns messages within the window, sessions always returned in full', () => {
    upsertSessions([
      session('alice', { lastTs: 1_700_000_000 }),
      session('bob', { lastTs: 1_500_000_000 }),
    ]);
    const NOW_SEC = 1_700_000_000;
    insertMessages([
      msg('alice', 1_700_000_000, 'me', 'recent'),
      msg('alice', 1_700_000_000 - 5 * 86400, 'them', 'within window'),
      msg('alice', 1_700_000_000 - 30 * 86400, 'them', 'before window'),
      msg('bob', 1_500_000_000, 'them', 'ancient'),
    ]);
    const snap = querySnapshot(14, NOW_SEC);
    expect(snap.sessions.map((s) => s.wxid).sort()).toEqual(['alice', 'bob']);
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages.every((m) => m.ts >= NOW_SEC - 14 * 86400)).toBe(true);
  });

  it('preserves group sender display for downstream AI prompts', () => {
    upsertSessions([session('team@chatroom', { display: '项目群', isGroup: true })]);
    insertMessages([
      msg('team@chatroom', 1_700_000_000, 'them', '今晚开会', 1, '张三'),
    ]);

    expect(querySnapshot(14, 1_700_000_100).messages[0]).toEqual(expect.objectContaining({
      senderDisplay: '张三',
    }));
  });
});

describe('searchMessages', () => {
  it('searches real mirrored text messages with scope and time filters', () => {
    upsertSessions([
      session('alice', { display: 'Alice', isGroup: false, lastTs: 1_700_000_000 }),
      session('team@chatroom', { display: '项目群', isGroup: true, lastTs: 1_700_000_010 }),
    ]);
    insertMessages([
      msg('alice', 1_700_000_000, 'me', '合同今天要确认'),
      msg('alice', 1_699_000_000, 'them', '旧合同不用看'),
      msg('team@chatroom', 1_700_000_010, 'them', '群里的合同提醒'),
      msg('team@chatroom', 1_700_000_020, 'them', '[图片]', 3),
    ]);

    expect(searchMessages({ query: '合同', limit: 10 }).map((item) => item.display)).toEqual([
      '项目群',
      'Alice',
      'Alice',
    ]);
    expect(searchMessages({ query: '项目群', limit: 10 }).map((item) => item.display)).toEqual(['项目群']);
    expect(searchMessages({ query: 'team@chatroom', limit: 10 }).map((item) => item.display)).toEqual(['项目群']);
    expect(searchMessages({ query: '合同', scope: 'personal', limit: 10 })).toHaveLength(2);
    expect(searchMessages({ query: '合同', scope: 'group', limit: 10 })).toHaveLength(1);
    expect(searchMessages({ query: '合同', sinceTs: 1_700_000_000, limit: 10 })).toHaveLength(2);
    expect(searchMessages({ query: '图片', limit: 10 })).toHaveLength(0);
  });

  it('escapes sqlite LIKE wildcards in user input', () => {
    upsertSessions([session('alice')]);
    insertMessages([
      msg('alice', 1, 'me', '100% 确认'),
      msg('alice', 2, 'me', '1000 确认'),
      msg('alice', 3, 'me', 'A_B'),
      msg('alice', 4, 'me', 'ACB'),
    ]);

    expect(searchMessages({ query: '100%', limit: 10 }).map((item) => item.content)).toEqual(['100% 确认']);
    expect(searchMessages({ query: 'A_B', limit: 10 }).map((item) => item.content)).toEqual(['A_B']);
  });

  it('returns readable chat and speaker names instead of WeChat internal ids', () => {
    upsertSessions([
      session('45434442516@chatroom', { display: '45434442516@chatroom', isGroup: true }),
    ]);
    insertMessages([
      msg(
        '45434442516@chatroom',
        1_700_000_000,
        'them',
        '5.6语文作业 订正默写本',
        1,
        '25984985930267888@openim',
      ),
    ]);

    const [result] = searchMessages({ query: '语文作业', limit: 10 });

    expect(result).toMatchObject({
      display: '微信群聊',
      senderDisplay: '群成员',
    });
  });
});

describe('getMessageContext', () => {
  it('returns nearby text messages from the same chat in chronological order', () => {
    upsertSessions([session('alice', { display: 'Alice' })]);
    insertMessages([
      msg('alice', 10, 'me', '前两句'),
      msg('alice', 20, 'them', '前一句'),
      msg('alice', 30, 'me', '命中消息'),
      msg('alice', 40, 'them', '后一句'),
      msg('alice', 50, 'them', '[图片]', 3),
      msg('bob', 35, 'them', '别的聊天不该出现'),
    ]);

    const context = getMessageContext('alice', 30, 3);

    expect(context).toMatchObject({
      wxid: 'alice',
      display: 'Alice',
      isGroup: false,
      targetTs: 30,
    });
    expect(context?.messages).toEqual([
      { ts: 10, sender: 'me', senderDisplay: null, content: '前两句' },
      { ts: 20, sender: 'them', senderDisplay: null, content: '前一句' },
      { ts: 30, sender: 'me', senderDisplay: null, content: '命中消息' },
      { ts: 40, sender: 'them', senderDisplay: null, content: '后一句' },
    ]);
  });

  it('returns null for invalid context requests', () => {
    expect(getMessageContext('', 30)).toBeNull();
    expect(getMessageContext('alice', 0)).toBeNull();
  });

  it('sanitizes internal ids in message context metadata', () => {
    upsertSessions([session('45434442516@chatroom', { display: '45434442516@chatroom', isGroup: true })]);
    insertMessages([
      msg('45434442516@chatroom', 30, 'them', '5.6语文作业', 1, '25984985930267888@openim'),
    ]);

    const context = getMessageContext('45434442516@chatroom', 30, 3);

    expect(context?.display).toBe('微信群聊');
    expect(context?.messages[0]?.senderDisplay).toBe('群成员');
  });
});

describe('getTopicRangeSummary', () => {
  it('sanitizes archived source displays from legacy topic rows', () => {
    saveTopicDailySummary({
      scope: 'group',
      businessDate: '2026-05-06',
      windowStartTs: 1_700_000_000,
      windowEndTs: 1_700_086_400,
      messageCount: 2,
      chatCount: 1,
      sources: [{
        wxid: '45434442516@chatroom',
        display: '45434442516@chatroom',
        isGroup: true,
        messageCount: 2,
        days: ['2026-05-06'],
        topics: [{
          title: '45434442516 客户群',
          summary: '25984985930267888@openim: 5.6语文作业需要确认',
          messageCount: 2,
          participants: ['25984985930267888@openim'],
        }],
      }],
    });

    const summary = getTopicRangeSummary('group', '2026-05-06', '2026-05-06');
    const visible = JSON.stringify({
      display: summary.sources[0]?.display,
      topics: summary.sources[0]?.topics,
    });

    expect(summary.sources[0]?.display).toBe('微信群聊');
    expect(visible).toContain('客户群');
    expect(visible).toContain('5.6语文作业需要确认');
    expect(visible).not.toContain('45434442516');
    expect(visible).not.toContain('@openim');
    expect(visible).not.toContain('@chatroom');
  });
});

describe('filterTopicRangeSummaryByAllowedWxids', () => {
  it('hides archived topic sources that are no longer allowed by the topic whitelist', () => {
    const summary: TopicRangeSummary = {
      scope: 'group',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-02',
      generatedAt: 1,
      windowDays: 0,
      state: 'done',
      error: null,
      chatCount: 2,
      messageCount: 30,
      topics: [],
      sources: [
        {
          wxid: 'allowed@chatroom',
          display: '允许群',
          isGroup: true,
          messageCount: 10,
          days: ['2026-05-02'],
          topics: [{
            title: '合同回款',
            summary: '允许群讨论合同回款',
            messageCount: 6,
            participants: ['允许群'],
          }],
        },
        {
          wxid: 'removed@chatroom',
          display: '已移除群',
          isGroup: true,
          messageCount: 20,
          days: ['2026-05-02'],
          topics: [{
            title: '合同回款',
            summary: '已移除群里更长的历史摘要不应泄露',
            messageCount: 12,
            participants: ['已移除群'],
          }],
        },
      ],
    };

    const filtered = filterTopicRangeSummaryByAllowedWxids(summary, new Set(['allowed@chatroom']));

    expect(filtered.sources.map((source) => source.wxid)).toEqual(['allowed@chatroom']);
    expect(filtered.chatCount).toBe(1);
    expect(filtered.messageCount).toBe(10);
    expect(filtered.topics).toEqual([{
      title: '合同回款',
      summary: '允许群讨论合同回款',
      messageCount: 6,
      participants: ['允许群'],
    }]);
  });
});

describe('sync_state', () => {
  it('cursor / lastFinishedAt / totalMessages round-trip through helpers', () => {
    expect(getSyncState().cursorTs).toBe(0);
    setCursor(1234);
    expect(getSyncState().cursorTs).toBe(1234);

    markSyncStarted();
    expect(getSyncState().firstStartedAt).toBeGreaterThan(0);

    markSyncFinished(42);
    const state1 = getSyncState();
    expect(state1.totalMessages).toBe(42);
    expect(state1.lastFinishedAt).toBeGreaterThan(0);
    expect(state1.lastError).toBeNull();

    markSyncFinished(8);
    expect(getSyncState().totalMessages).toBe(50);
  });

  it('setLastError sets and clears', () => {
    setLastError('boom');
    expect(getSyncState().lastError).toBe('boom');
    setLastError(null);
    expect(getSyncState().lastError).toBeNull();
  });

  it('markSyncFinished clears any previous lastError', () => {
    setLastError('old failure');
    markSyncFinished(1);
    expect(getSyncState().lastError).toBeNull();
  });
});
