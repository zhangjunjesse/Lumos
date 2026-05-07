import {
  computeOverview,
  type SnapshotInput,
  type SnapshotMessage,
  type SnapshotSession,
} from '../overview-compute';

const NOW = new Date('2026-05-05T12:00:00Z').getTime();
const SECOND = 1000;
const DAY = 24 * 60 * 60 * 1000;

function s(wxid: string, last_timestamp: number, isGroup = false): SnapshotSession {
  return {
    wxid,
    display: wxid.replace('@chatroom', '群'),
    is_group: isGroup,
    last_timestamp: last_timestamp / SECOND, // api.py emits seconds
  };
}

function m(wxid: string, daysAgo: number, sender: 'me' | 'them', content: string): SnapshotMessage {
  return { wxid, ts: (NOW - daysAgo * DAY) / SECOND, sender, content };
}

function mAt(wxid: string, tsMs: number, sender: 'me' | 'them', content: string): SnapshotMessage {
  return { wxid, ts: tsMs / SECOND, sender, content };
}

describe('computeOverview', () => {
  it('aggregates message counts within window', () => {
    const input: SnapshotInput = {
      sessions: [s('alice', NOW - 1 * DAY), s('bob', NOW - 2 * DAY)],
      messages: [
        m('alice', 0, 'me', '你今天忙不忙'),
        m('alice', 1, 'them', '今天有点累'),
        m('alice', 20, 'me', '老消息超出窗口'),
        m('bob', 1, 'me', '项目进度怎样'),
      ],
    };

    const out = computeOverview(input, { windowDays: 14, excludedIds: [], nowMs: NOW });
    expect(out.totals.activeChats).toBe(2);
    expect(out.totals.messagesInWindow).toBe(3); // 20-day-old message dropped
    const alice = out.rows.find((r) => r.id === 'alice')!;
    expect(alice.messageCount).toBe(2);
    expect(alice.yourShare).toBeCloseTo(0.5, 2);
  });

  it('drops excluded ids from rows, totals, and word stream', () => {
    const input: SnapshotInput = {
      sessions: [s('alice', NOW), s('group@chatroom', NOW, true)],
      messages: [
        m('alice', 0, 'them', '保密话题'),
        m('group@chatroom', 0, 'them', '群消息保密话题'),
      ],
    };

    const out = computeOverview(input, {
      windowDays: 14,
      excludedIds: ['group@chatroom'],
      nowMs: NOW,
    });
    expect(out.rows.map((r) => r.id)).toEqual(['alice']);
    expect(out.totals.messagesInWindow).toBe(1);
    expect(out.reportInsights.emoji).toHaveLength(0);
  });

  it('builds 14-day heatmap indexed by daysAgo', () => {
    const input: SnapshotInput = {
      sessions: [s('alice', NOW)],
      messages: [
        m('alice', 0, 'me', 'hi'),
        m('alice', 0, 'them', 'hi'),
        m('alice', 5, 'me', 'wave'),
        m('alice', 13, 'them', 'old'),
        m('alice', 14, 'them', 'out of heat range but in 14d window? no'),
      ],
    };
    // windowDays=14 means floor at NOW - 14*DAY (exclusive). daysAgo=14 message
    // sits exactly on the boundary -> excluded.
    const out = computeOverview(input, { windowDays: 14, excludedIds: [], nowMs: NOW });
    const alice = out.rows[0]!;
    expect(alice.interactionDays).toHaveLength(14);
    expect(alice.interactionDays[0].count).toBe(2);
    expect(alice.interactionDays[5].count).toBe(1);
    expect(alice.interactionDays[13].count).toBe(1);
  });

  it('counts silentCount as sessions silent 14-60d, regardless of windowDays', () => {
    const input: SnapshotInput = {
      sessions: [
        s('recent', NOW - 1 * DAY), // active, not silent
        s('quiet', NOW - 20 * DAY), // silent in [14,60]
        s('zombie', NOW - 80 * DAY), // way too old, not in silent band
      ],
      messages: [m('recent', 0, 'them', '在吗')],
    };
    const out = computeOverview(input, { windowDays: 7, excludedIds: [], nowMs: NOW });
    expect(out.totals.silentCount).toBe(1);
    expect(out.rows.map((r) => r.id)).toEqual(['recent']);
  });

  it('synthesizes a stub session for wxids that have messages but no session entry', () => {
    const input: SnapshotInput = {
      sessions: [s('alice', NOW)],
      messages: [
        m('alice', 0, 'them', 'ok'),
        m('orphan@chatroom', 0, 'them', '会议讨论项目进度'),
        m('orphan@chatroom', 1, 'them', '会议讨论项目进度'),
        m('lone-friend', 0, 'them', '私聊也要计入'),
      ],
    };
    const out = computeOverview(input, { windowDays: 14, excludedIds: [], nowMs: NOW });
    const ids = out.rows.map((r) => r.id).sort();
    expect(ids).toEqual(['alice', 'lone-friend', 'orphan@chatroom']);
    expect(out.totals.messagesInWindow).toBe(4);
    // is_group derived from @chatroom suffix when session metadata missing
    expect(out.rows.find((r) => r.id === 'orphan@chatroom')!.isGroup).toBe(true);
    expect(out.rows.find((r) => r.id === 'lone-friend')!.isGroup).toBe(false);
  });

  it('uses product-facing names and text when source data contains internal ids', () => {
    const input: SnapshotInput = {
      sessions: [
        {
          wxid: '45434442516@chatroom',
          display: '45434442516@chatroom',
          is_group: true,
          last_timestamp: NOW / SECOND,
        },
        {
          wxid: '25984985930267888@openim',
          display: '25984985930267888@openim',
          is_group: false,
          last_timestamp: NOW / SECOND,
        },
      ],
      messages: [
        m('45434442516@chatroom', 0, 'them', '25984985930267888@openim: 5.6语文作业'),
        m('25984985930267888@openim', 0, 'me', '25984985930267888@openim: 我明天发方案'),
      ],
    };

    const out = computeOverview(input, { windowDays: 14, excludedIds: [], nowMs: NOW });

    expect(out.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['微信联系人', '微信群聊']));
    expect(out.reportInsights.commitments[0]).toEqual(expect.objectContaining({
      text: '我明天发方案',
      who: '微信联系人',
    }));
    const displayed = JSON.stringify({
      rowNames: out.rows.map((row) => row.name),
      lateChatNames: out.reportInsights.lateChat.rows.map((row) => row.name),
      commitmentTexts: out.reportInsights.commitments.map((item) => item.text),
      commitmentWhos: out.reportInsights.commitments.map((item) => item.who),
      mentionWeekNames: out.reportInsights.mentionWeek.map((item) => item.name),
    });
    expect(displayed).not.toContain('@openim');
    expect(displayed).not.toContain('@chatroom');
    expect(displayed).not.toContain('45434442516');
  });

  it('builds real custom-report insights from the message stream', () => {
    const localNow = new Date(2026, 4, 6, 12, 0).getTime();
    const aliceLate = new Date(2026, 4, 5, 23, 30).getTime();
    const groupLate = new Date(2026, 4, 4, 23, 0).getTime();
    const bobDaytime = new Date(2026, 4, 5, 10, 0).getTime();
    const input: SnapshotInput = {
      sessions: [
        s('alice', aliceLate),
        s('bob', bobDaytime),
        s('group@chatroom', groupLate, true),
      ],
      messages: [
        mAt('alice', aliceLate, 'me', '我明天发方案 😂😂'),
        mAt('bob', bobDaytime, 'them', '收到 😂'),
        mAt('group@chatroom', groupLate, 'them', '群里也在讨论 😂'),
      ],
    };

    const out = computeOverview(input, { windowDays: 14, excludedIds: [], nowMs: localNow });
    expect(out.reportInsights.emoji[0]).toEqual({ emoji: '😂', count: 4 });
    expect(out.reportInsights.lateChat.totalLateMessages).toBe(2);
    expect(out.reportInsights.lateChat.rows.map((r) => r.name)).toEqual(['alice', 'group群']);
    expect(out.reportInsights.commitments[0]).toEqual(expect.objectContaining({
      text: '我明天发方案 😂😂',
      who: 'alice',
      promisedAt: aliceLate,
    }));
    expect(out.reportInsights.mentionWeek.map((r) => r.id).sort()).toEqual(['alice', 'bob', 'group@chatroom']);
  });

  it('still drops messages from explicitly excluded ids', () => {
    const input: SnapshotInput = {
      sessions: [s('alice', NOW)],
      messages: [
        m('alice', 0, 'them', 'ok'),
        m('blocked', 0, 'them', '不该被分析'),
      ],
    };
    const out = computeOverview(input, {
      windowDays: 14,
      excludedIds: ['blocked'],
      nowMs: NOW,
    });
    expect(out.rows.map((r) => r.id)).toEqual(['alice']);
    expect(out.totals.messagesInWindow).toBe(1);
  });

});
