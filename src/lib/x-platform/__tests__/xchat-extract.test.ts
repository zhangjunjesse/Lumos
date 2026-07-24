import { parseXChatConversation, parseXChatInbox } from '../xchat-extract';

describe('parseXChatConversation', () => {
  it('解析消息 + rawLines,状态 ok', () => {
    const raw = JSON.stringify({
      locked: false,
      needsLogin: false,
      messages: [
        { text: '你好', outgoing: false },
        { text: 'test123', outgoing: false },
        { text: '', outgoing: true },
      ],
      rawLines: ['你好', 'test123'],
      title: 'Jesse',
      url: 'https://x.com/i/chat/750490858516910080-1538825150593871872',
    });
    const out = parseXChatConversation(raw)!;
    expect(out.status).toBe('ok');
    expect(out.messages.map((m) => m.text)).toEqual(['你好', 'test123']); // 空文本被过滤
    expect(out.title).toBe('Jesse');
  });

  it('锁屏 → status=locked', () => {
    const out = parseXChatConversation(
      JSON.stringify({ locked: true, needsLogin: false, messages: [], rawLines: ['Enter your passcode'] }),
    )!;
    expect(out.status).toBe('locked');
  });

  it('未登录优先于锁屏', () => {
    const out = parseXChatConversation(
      JSON.stringify({ locked: true, needsLogin: true, messages: [], rawLines: [] }),
    )!;
    expect(out.status).toBe('needs_login');
  });

  it('无消息无文本 → empty;非法输入 → null', () => {
    expect(parseXChatConversation(JSON.stringify({ messages: [], rawLines: [] }))!.status).toBe('empty');
    expect(parseXChatConversation('not json')).toBeNull();
    expect(parseXChatConversation('')).toBeNull();
  });

  it('结构化落空但有 rawLines 时仍判 ok(兜底文本可用)', () => {
    const out = parseXChatConversation(
      JSON.stringify({ locked: false, needsLogin: false, messages: [], rawLines: ['你好', 'test123'] }),
    )!;
    expect(out.status).toBe('ok');
    expect(out.rawLines).toEqual(['你好', 'test123']);
  });
});

describe('parseXChatInbox', () => {
  it('解析会话列表并提取 conversationId/name/preview', () => {
    const out = parseXChatInbox(
      JSON.stringify({
        locked: false,
        needsLogin: false,
        items: [
          { conversationId: '750490858516910080-1538825150593871872', name: 'Jesse', preview: 'test123' },
        ],
        rawLines: ['Jesse', 'test123'],
      }),
    )!;
    expect(out.status).toBe('ok');
    expect(out.items[0].conversationId).toBe('750490858516910080-1538825150593871872');
    expect(out.items[0].name).toBe('Jesse');
  });

  it('锁屏 → locked;空 → empty', () => {
    expect(parseXChatInbox(JSON.stringify({ locked: true, items: [], rawLines: [] }))!.status).toBe('locked');
    expect(parseXChatInbox(JSON.stringify({ items: [], rawLines: [] }))!.status).toBe('empty');
  });
});
