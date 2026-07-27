// dm.ts 的 XChat 浏览器兜底路径:老 API 空 → 走浏览器读 XChat。
// 用 mock 隔离 scraper(老 API)、auth、xchat-browser 三个依赖。

jest.mock('../scraper', () => ({ ensureScraper: jest.fn() }));
jest.mock('../auth', () => ({ getAuthStatus: jest.fn() }));
jest.mock('../xchat-browser', () => ({
  readXChatInbox: jest.fn(),
  readXChatConversation: jest.fn(),
}));

import { getDmInboxView, getDmConversationView } from '../dm';
import { ensureScraper } from '../scraper';
import { getAuthStatus } from '../auth';
import { readXChatInbox, readXChatConversation } from '../xchat-browser';

const mockScraper = ensureScraper as jest.Mock;
const mockAuth = getAuthStatus as jest.Mock;
const mockInbox = readXChatInbox as jest.Mock;
const mockConv = readXChatConversation as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: '1538825150593871872' });
});

describe('getDmInboxView — 老 API 空时走 XChat 浏览器兜底', () => {
  it('老 API 有会话时不触发浏览器', async () => {
    mockScraper.mockResolvedValue({
      getDmInbox: async () => ({
        entries: [{ message: { conversation_id: 'c1', message_data: { text: 'hi', time: '5', sender_id: 'x' } } }],
        conversations: { c1: { conversation_id: 'c1', participants: [{ user_id: 'x' }, { user_id: '1538825150593871872' }] } },
        users: {},
      }),
    });
    const view = await getDmInboxView();
    expect(view.source).toBe('legacy');
    expect(mockInbox).not.toHaveBeenCalled();
  });

  it('老 API 空 → 浏览器读到 XChat 会话', async () => {
    mockScraper.mockResolvedValue({ getDmInbox: async () => ({ entries: [], conversations: {}, users: {} }) });
    mockInbox.mockResolvedValue({
      ok: true,
      data: { status: 'ok', items: [{ conversationId: 'c-xchat', name: 'Jesse', preview: 'test123' }], rawLines: [] },
    });
    const view = await getDmInboxView();
    expect(view.source).toBe('xchat-browser');
    expect(view.conversations[0].peer?.name).toBe('Jesse');
    expect(view.notice).toContain('XChat');
  });

  it('XChat 锁屏 → 明确 notice,不谎称没有私信', async () => {
    mockScraper.mockResolvedValue({ getDmInbox: async () => ({ entries: [], conversations: {}, users: {} }) });
    mockInbox.mockResolvedValue({ ok: true, data: { status: 'locked', items: [], rawLines: [] } });
    const view = await getDmInboxView();
    expect(view.conversations).toHaveLength(0);
    // 断言的是「说清去哪解锁」,不是某句固定文案。#52:旧文案只说「被密码锁定」,
    // 用户前台页根本没有密码框,不知道该去哪输 —— 提示必须可操作。
    expect(view.notice).toMatch(/解锁/);
    expect(view.notice).toContain('x.com/i/chat');
    expect(view.notice).toContain('保持该页面开着');
  });
});

describe('getDmConversationView — 有 peer 却零消息时走 XChat 兜底', () => {
  it('老 API 有消息时不触发浏览器', async () => {
    mockScraper.mockResolvedValue({
      getDmConversation: async () => ({
        entries: [{ message: { id: 'm1', message_data: { text: 'hi', time: '5', sender_id: 'peer' } } }],
        conversations: { conv: { participants: [{ user_id: 'peer' }, { user_id: '1538825150593871872' }] } },
        users: { peer: { name: 'Jesse', screen_name: 'Flying_Jesse' } },
        status: 'AT_END',
        min_entry_id: '',
      }),
    });
    const view = await getDmConversationView('conv');
    expect(view.source).toBe('legacy');
    expect(mockConv).not.toHaveBeenCalled();
  });

  it('老 API 零消息 → 浏览器读 XChat 正文(结构化)', async () => {
    mockScraper.mockResolvedValue({
      getDmConversation: async () => ({
        entries: [],
        conversations: { conv: { participants: [{ user_id: 'peer' }, { user_id: '1538825150593871872' }] } },
        users: { peer: { name: 'Jesse', screen_name: 'Flying_Jesse' } },
        status: 'AT_END',
        min_entry_id: '',
      }),
    });
    mockConv.mockResolvedValue({
      ok: true,
      data: { status: 'ok', messages: [{ text: '你好', outgoing: false }, { text: 'test123', outgoing: false }], rawLines: [], title: '', url: '' },
    });
    const view = await getDmConversationView('conv');
    expect(view.source).toBe('xchat-browser');
    expect(view.messages.map((m) => m.text)).toEqual(['你好', 'test123']);
    expect(view.peer?.name).toBe('Jesse'); // peer 仍来自老 API 元数据
  });

  it('结构化落空时用 rawLines 兜底成消息', async () => {
    mockScraper.mockResolvedValue({
      getDmConversation: async () => ({ entries: [], conversations: {}, users: {}, status: 'AT_END', min_entry_id: '' }),
    });
    mockConv.mockResolvedValue({
      ok: true,
      data: { status: 'ok', messages: [], rawLines: ['你好', 'test123'], title: '', url: '' },
    });
    const view = await getDmConversationView('conv');
    expect(view.messages.map((m) => m.text)).toEqual(['你好', 'test123']);
  });
});
