import { cropSnapshotForLlm } from '../ai-snapshot-crop';
import type { WeChatSnapshot, WeChatSnapshotMessage } from '../analysis';

const NOW = Math.floor(new Date('2026-05-04T12:00:00Z').getTime() / 1000);

function buildSnapshot(messages: WeChatSnapshotMessage[]): WeChatSnapshot {
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

describe('cropSnapshotForLlm', () => {
  it('drops system messages and pure placeholders', () => {
    const snap = buildSnapshot([
      { wxid: 'a', display: 'A', isGroup: false, ts: NOW, sender: 'them', type: 1, content: '你好' },
      { wxid: 'a', display: 'A', isGroup: false, ts: NOW, sender: 'them', type: 10000, content: '系统消息' },
      { wxid: 'a', display: 'A', isGroup: false, ts: NOW, sender: 'them', type: 1, content: '[图片]' },
    ]);
    const result = cropSnapshotForLlm(snap);
    expect(result.messages.map((m) => m.text)).toEqual(['你好']);
  });

  it('limits to last windowDays of messages', () => {
    const snap = buildSnapshot([
      { wxid: 'a', display: 'A', isGroup: false, ts: NOW - 30 * 86400, sender: 'them', type: 1, content: '太久' },
      { wxid: 'a', display: 'A', isGroup: false, ts: NOW - 1 * 86400, sender: 'them', type: 1, content: '昨天' },
      { wxid: 'a', display: 'A', isGroup: false, ts: NOW, sender: 'them', type: 1, content: '今天' },
    ]);
    const result = cropSnapshotForLlm(snap, { windowDays: 14 });
    expect(result.messages.map((m) => m.text).sort()).toEqual(['今天', '昨天']);
  });

  it('keeps only last N per conversation', () => {
    const messages: WeChatSnapshotMessage[] = [];
    for (let i = 0; i < 200; i += 1) {
      messages.push({
        wxid: 'a',
        display: 'A',
        isGroup: false,
        ts: NOW - (200 - i) * 60,
        sender: 'them',
        type: 1,
        content: `m${i}`,
      });
    }
    const result = cropSnapshotForLlm(buildSnapshot(messages), { perConvLimit: 30 });
    expect(result.messages.length).toBe(30);
    expect(result.messages[0].text).toBe('m170');
    expect(result.messages[29].text).toBe('m199');
  });

  it('caps total messages at globalLimit, drops low-signal conversations first', () => {
    const messages: WeChatSnapshotMessage[] = [];
    // 高信号：你说过话，有问号
    for (let i = 0; i < 30; i += 1) {
      messages.push({
        wxid: 'high',
        display: '高信号',
        isGroup: false,
        ts: NOW - i * 60,
        sender: i % 2 === 0 ? 'me' : 'them',
        type: 1,
        content: `重要事 怎么样了？${i}`,
      });
    }
    // 低信号群广播
    for (let i = 0; i < 100; i += 1) {
      messages.push({
        wxid: 'low@chatroom',
        display: '广播群',
        isGroup: true,
        ts: NOW - i * 60,
        sender: 'them',
        type: 1,
        content: `通知 ${i}`,
      });
    }
    const result = cropSnapshotForLlm(buildSnapshot(messages), { globalLimit: 40 });
    const highKept = result.messages.filter((m) => m.wxid === 'high').length;
    expect(highKept).toBe(30);
    expect(result.messages.length).toBeLessThanOrEqual(40);
  });

  it('produces stable idx mapping starting from 0', () => {
    const snap = buildSnapshot([
      { wxid: 'a', display: 'A', isGroup: false, ts: NOW - 10, sender: 'them', type: 1, content: '一' },
      { wxid: 'a', display: 'A', isGroup: false, ts: NOW, sender: 'me', type: 1, content: '二' },
    ]);
    const result = cropSnapshotForLlm(snap);
    expect(result.messages.map((m) => m.idx)).toEqual([0, 1]);
  });
});
