// 登录墙守卫回归(#48/#49)。
//
// 病史:后台自动化页停在 X 的 JetFuel 登录墙上,而解析器把「使用手机继续」「电子邮箱或
// 用户名」这些按钮文案当成私信内容返回给用户。两道闸都没拦住:
//   1. 页内正则写的是 /登录到 X/,X 中文登录墙实际是「登录 X」—— 差一个字
//   2. pathname 兜底也没用:X 在 /i/chat/<id> 上**内联**渲染登录墙,路径不变
// 而 classify 只要 rawLines 非空就判 'ok',于是登录页整页文本被当成消息。
//
// 用真实现场 fixture 锁住:登录墙必须判 needs_login,inbox 与 conversation 结论一致。

import {
  looksLikeLoginWall,
  parseXChatConversation,
  parseXChatInbox,
} from '../xchat-extract';
import {
  LOGIN_WALL_RAW_LINES,
  LOGIN_WALL_TESTIDS,
  REAL_CONVERSATION_RAW_LINES,
} from './__fixtures__/xchat-login-wall';

describe('looksLikeLoginWall', () => {
  it('认出真实抓到的那张登录墙', () => {
    expect(looksLikeLoginWall(LOGIN_WALL_RAW_LINES)).toBe(true);
  });

  it('JetFuel 登录容器 testid 单独出现即可定性', () => {
    expect(looksLikeLoginWall([], LOGIN_WALL_TESTIDS)).toBe(true);
  });

  it('英文登录墙同样认出', () => {
    expect(looksLikeLoginWall(['Sign in to X', 'Create account'])).toBe(true);
  });

  it('「登录 X」少一个「到」字也要认出 —— 这正是过去漏判的原因', () => {
    expect(looksLikeLoginWall(['登录 X', '电子邮箱或用户名'])).toBe(true);
  });

  it('真会话内容不误杀', () => {
    expect(looksLikeLoginWall(REAL_CONVERSATION_RAW_LINES)).toBe(false);
  });

  it('聊天里偶然提到一次登录相关词不误杀(要 ≥2 条特征)', () => {
    expect(looksLikeLoginWall(['你用使用 Google 继续那个按钮登进去就行', '好的'])).toBe(false);
  });

  it('空输入不误判', () => {
    expect(looksLikeLoginWall([])).toBe(false);
    expect(looksLikeLoginWall(['', '  '])).toBe(false);
  });
});

describe('parseXChatConversation 遇到登录墙', () => {
  const loginWallJson = JSON.stringify({
    locked: false,
    needsLogin: false, // 页内正则漏判 —— 复现 #48 的真实情形
    messages: [],
    rawLines: LOGIN_WALL_RAW_LINES,
    title: 'X',
    url: 'https://x.com/i/chat/750490858516910080-1538825150593871872',
    diag: { testids: LOGIN_WALL_TESTIDS, regionHtml: '<main role="main">...</main>' },
  });

  it('判 needs_login,而不是 ok', () => {
    expect(parseXChatConversation(loginWallJson)!.status).toBe('needs_login');
  });

  it('不把登录页文案当成消息', () => {
    const out = parseXChatConversation(loginWallJson)!;
    expect(out.messages).toEqual([]);
    // 上层只在 status==='ok' 时才会消费 rawLines,这里已经不是 ok 了
    expect(out.status).not.toBe('ok');
  });

  it('真会话仍然正常判 ok', () => {
    const json = JSON.stringify({
      locked: false, needsLogin: false,
      messages: [{ text: 'hi', outgoing: false }, { text: '你好', outgoing: true }],
      rawLines: REAL_CONVERSATION_RAW_LINES,
      title: 'X', url: 'https://x.com/i/chat/1',
      diag: { testids: ['messageEntry'], regionHtml: '' },
    });
    const out = parseXChatConversation(json)!;
    expect(out.status).toBe('ok');
    expect(out.messages).toHaveLength(2);
  });

  it('选择器落空但页面确有真内容时,rawLines 兜底仍然可用', () => {
    const json = JSON.stringify({
      locked: false, needsLogin: false,
      messages: [],
      rawLines: REAL_CONVERSATION_RAW_LINES,
      title: 'X', url: 'https://x.com/i/chat/1',
      diag: { testids: [], regionHtml: '' },
    });
    expect(parseXChatConversation(json)!.status).toBe('ok');
  });
});

describe('parseXChatInbox 遇到登录墙', () => {
  const loginWallJson = JSON.stringify({
    locked: false,
    needsLogin: false,
    items: [],
    rawLines: LOGIN_WALL_RAW_LINES,
    diag: { testids: LOGIN_WALL_TESTIDS, regionHtml: '' },
  });

  it('判 needs_login,而不是 empty —— 「没登录」和「真没会话」是两回事', () => {
    expect(parseXChatInbox(loginWallJson)!.status).toBe('needs_login');
  });

  it('与 conversation 对同一张登录页给出同一结论(过去两边分叉成两种症状)', () => {
    const convJson = JSON.stringify({
      locked: false, needsLogin: false, messages: [], rawLines: LOGIN_WALL_RAW_LINES,
      title: '', url: '', diag: { testids: LOGIN_WALL_TESTIDS, regionHtml: '' },
    });
    expect(parseXChatInbox(loginWallJson)!.status)
      .toBe(parseXChatConversation(convJson)!.status);
  });

  it('真的没有会话时才判 empty', () => {
    const json = JSON.stringify({
      locked: false, needsLogin: false, items: [], rawLines: ['没有消息'],
      diag: { testids: ['DMDrawer'], regionHtml: '' },
    });
    expect(parseXChatInbox(json)!.status).toBe('empty');
  });
});
