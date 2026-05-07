import {
  buildWeChatPortrait,
} from '@/lib/wechat-assistant/portrait';
import type {
  WeChatSnapshot,
  WeChatSnapshotMessage,
} from '@/lib/wechat-assistant/analysis';

const DAY = 24 * 60 * 60;

function snapshotOf(messages: WeChatSnapshotMessage[]): WeChatSnapshot {
  return {
    sessions: [],
    messages,
    sessionsScanned: 0,
    messagesScanned: messages.length,
    totalReadableMessages: messages.length,
    selectedReadableMessages: messages.length,
    messagesTruncated: false,
    scanScope: 'all_readable_wechat_messages',
    safetyLimit: 50000,
  };
}

function tsAt(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Math.floor(new Date(year, month - 1, day, hour, minute, 0).getTime() / 1000);
}

describe('buildWeChatPortrait', () => {
  it('returns an empty portrait when no usable messages', () => {
    const portrait = buildWeChatPortrait(snapshotOf([]));
    expect(portrait.generated).toBe(false);
    expect(portrait.rhythm.daysActive).toBe(0);
    expect(portrait.style.yourMessageCount).toBe(0);
    expect(portrait.highlights).toEqual([]);
  });

  it('detects late-night rhythm and computes hourly distribution', () => {
    const messages: WeChatSnapshotMessage[] = [];
    for (let i = 0; i < 30; i += 1) {
      messages.push({
        wxid: 'wxid_pal',
        display: '夜聊朋友',
        isGroup: false,
        ts: tsAt(2026, 4, 10 + (i % 5), 1, i % 60),
        sender: i % 2 === 0 ? 'them' : 'me',
        type: 1,
        content: 'hi 还在吗？',
      });
    }
    for (let i = 0; i < 6; i += 1) {
      messages.push({
        wxid: 'wxid_pal',
        display: '夜聊朋友',
        isGroup: false,
        ts: tsAt(2026, 4, 10, 14, i),
        sender: 'me',
        type: 1,
        content: '下午也来一句',
      });
    }
    const portrait = buildWeChatPortrait(snapshotOf(messages));
    expect(portrait.generated).toBe(true);
    expect(portrait.rhythm.peakHour).toBe(1);
    expect(portrait.rhythm.lateNightShare).toBeGreaterThan(0.3);
    expect(['深夜玩家', '夜猫子']).toContain(portrait.rhythm.label);
    expect(portrait.rhythm.hourly).toHaveLength(24);
    expect(portrait.rhythm.weekly).toHaveLength(7);
  });

  it('flags rising contacts and silent friends in the relationship radar', () => {
    const now = tsAt(2026, 5, 4, 12);
    const messages: WeChatSnapshotMessage[] = [];
    // 升温联系人：最近两周高频
    for (let i = 0; i < 12; i += 1) {
      messages.push({
        wxid: 'wxid_rising',
        display: '新搭档',
        isGroup: false,
        ts: now - i * 60 * 60 * 4,
        sender: i % 2 === 0 ? 'me' : 'them',
        type: 1,
        content: '今天对一下方案进度',
      });
    }
    // 老朋友：之前频繁，最近沉默
    for (let i = 0; i < 8; i += 1) {
      messages.push({
        wxid: 'wxid_silent',
        display: '老同学',
        isGroup: false,
        ts: now - 40 * DAY - i * 60 * 60,
        sender: i % 2 === 0 ? 'them' : 'me',
        type: 1,
        content: '聚餐再约',
      });
    }
    const portrait = buildWeChatPortrait(snapshotOf(messages));
    expect(portrait.relationships.rising.some((c) => c.wxid === 'wxid_rising')).toBe(true);
    expect(portrait.relationships.silent.some((c) => c.wxid === 'wxid_silent')).toBe(true);
    expect(portrait.relationships.summary).toContain('升温');
  });

  it('computes responsiveness medians from alternating senders', () => {
    const base = tsAt(2026, 5, 4, 10);
    const messages: WeChatSnapshotMessage[] = [];
    let cursor = base;
    for (let i = 0; i < 8; i += 1) {
      messages.push({
        wxid: 'wxid_ping',
        display: '工作伙伴',
        isGroup: false,
        ts: cursor,
        sender: 'them',
        type: 1,
        content: '在吗？',
      });
      cursor += 60 * 2; // 2 min
      messages.push({
        wxid: 'wxid_ping',
        display: '工作伙伴',
        isGroup: false,
        ts: cursor,
        sender: 'me',
        type: 1,
        content: '在的，说事',
      });
      cursor += 60 * 30; // wait 30 min for next round
    }
    const portrait = buildWeChatPortrait(snapshotOf(messages));
    expect(portrait.responsiveness.yourMedianMinutes).not.toBeNull();
    expect(portrait.responsiveness.yourMedianMinutes!).toBeLessThan(5);
    expect(portrait.responsiveness.fastestForYou.length).toBeGreaterThanOrEqual(0);
  });

  it('builds a style fingerprint from your own messages', () => {
    const base = tsAt(2026, 5, 4, 9);
    const yourMessages: WeChatSnapshotMessage[] = Array.from({ length: 12 }, (_, i) => ({
      wxid: 'wxid_team',
      display: '团队',
      isGroup: false,
      ts: base + i * 60,
      sender: 'me',
      type: 1,
      content: i % 2 === 0 ? '需要确认这个方案吗？' : '这个事情我去推进 😀 '.repeat(2),
    }));
    const theirMessages: WeChatSnapshotMessage[] = Array.from({ length: 4 }, (_, i) => ({
      wxid: 'wxid_team',
      display: '团队',
      isGroup: false,
      ts: base - i * 60,
      sender: 'them',
      type: 1,
      content: '好的',
    }));
    const portrait = buildWeChatPortrait(snapshotOf([...yourMessages, ...theirMessages]));
    expect(portrait.style.yourMessageCount).toBe(12);
    expect(portrait.style.questionRate).toBeGreaterThan(0);
    expect(portrait.style.wordTop.length).toBeGreaterThan(0);
    expect(portrait.style.label).not.toBe('尚无样本');
  });

  it('classifies group roles by participation', () => {
    const base = tsAt(2026, 5, 4, 14);
    const messages: WeChatSnapshotMessage[] = [];
    // 灵魂群：你说很多
    for (let i = 0; i < 60; i += 1) {
      messages.push({
        wxid: 'soul@chatroom',
        display: '灵魂群',
        isGroup: true,
        ts: base - i * 60,
        sender: i % 3 === 0 ? 'them' : 'me',
        type: 1,
        content: '今天聊点别的',
      });
    }
    // 潜水群：你不说话
    for (let i = 0; i < 40; i += 1) {
      messages.push({
        wxid: 'lurk@chatroom',
        display: '潜水群',
        isGroup: true,
        ts: base - i * 60,
        sender: 'them',
        type: 1,
        content: '群消息播报',
      });
    }
    const portrait = buildWeChatPortrait(snapshotOf(messages));
    const soul = portrait.groups.topGroups.find((g) => g.wxid === 'soul@chatroom');
    const lurk = portrait.groups.topGroups.find((g) => g.wxid === 'lurk@chatroom');
    expect(soul?.role).toMatch(/灵魂|气氛|广播/);
    expect(lurk?.role).toBe('潜水党');
  });

  it('records highlights including longest round and golden hour', () => {
    const base = tsAt(2026, 5, 4, 21);
    const messages: WeChatSnapshotMessage[] = [];
    for (let i = 0; i < 12; i += 1) {
      messages.push({
        wxid: 'wxid_close',
        display: '密友',
        isGroup: false,
        ts: base + i * 60,
        sender: i % 2 === 0 ? 'them' : 'me',
        type: 1,
        content: i === 5 ? '我和你说一个长一点的故事，是关于昨天那个事情的整体复盘以及一些我自己的反思。' : '哈哈',
      });
    }
    const portrait = buildWeChatPortrait(snapshotOf(messages));
    expect(portrait.highlights.length).toBeGreaterThan(0);
    expect(portrait.highlights.some((h) => h.label.includes('对话'))).toBe(true);
    expect(portrait.highlights.some((h) => h.label.includes('小时'))).toBe(true);
  });
});
