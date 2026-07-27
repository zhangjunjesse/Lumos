// XChat 端到端加密解锁页(passcode)判定回归(#51/#52)。
//
// 病史链:
//   v0.39.14 后台页停在登录墙 → 被当私信返回(#48/#49)
//   v0.39.15 加了登录墙守卫 → 不再吐噪音,但读不到(#50)
//   v0.39.16 注入 cookie 后**登录成功了**,却停在 Enter Passcode(#51/#52)
//
// 这一步的要点是**区分两种「读不到」**:
//   needs_login — 真没登录,该去登录
//   locked      — 已经登录了,只是解不开密文,该去解锁(去登录毫无用处)
// #52 的用户就是被「请重新登录」误导的:他明明登录着,前台页还看得见消息。

import {
  looksLikeLoginWall,
  looksLikePasscodeGate,
  parseXChatConversation,
  parseXChatInbox,
} from '../xchat-extract';
import {
  PASSCODE_PAGE_RAW_LINES,
  PASSCODE_PAGE_TESTIDS,
} from './__fixtures__/xchat-passcode-gate';
import { LOGIN_WALL_RAW_LINES, LOGIN_WALL_TESTIDS } from './__fixtures__/xchat-login-wall';

describe('looksLikePasscodeGate', () => {
  it('认出真实抓到的那张 passcode 页', () => {
    expect(looksLikePasscodeGate(PASSCODE_PAGE_RAW_LINES, PASSCODE_PAGE_TESTIDS)).toBe(true);
  });

  it('只靠 pin-code-input-container 这个 testid 也能认出', () => {
    expect(looksLikePasscodeGate([], ['pin-code-input-container'])).toBe(true);
  });

  it('只靠文案也能认出(X 改 testid 时的兜底)', () => {
    expect(looksLikePasscodeGate(['Enter Passcode', 'Forgot passcode'])).toBe(true);
    expect(looksLikePasscodeGate(['recover your encryption keys'])).toBe(true);
  });

  it('中文解锁文案同样认出', () => {
    expect(looksLikePasscodeGate(['请输入密码解锁'])).toBe(true);
  });

  it('真会话不误杀', () => {
    expect(looksLikePasscodeGate(['hi', '你好', 'test123'])).toBe(false);
  });

  it('登录墙不会被误判成 passcode 页(两者要分开)', () => {
    expect(looksLikePasscodeGate(LOGIN_WALL_RAW_LINES, LOGIN_WALL_TESTIDS)).toBe(false);
  });
});

describe('passcode 页必须判 locked 而不是 needs_login', () => {
  const build = (kind: 'inbox' | 'conversation') => JSON.stringify({
    locked: false,      // 页内 locked 正则也漏了 —— 复现真实情形
    needsLogin: false,
    ...(kind === 'inbox' ? { items: [] } : { messages: [], title: 'X', url: 'https://x.com/i/chat/1' }),
    rawLines: PASSCODE_PAGE_RAW_LINES,
    diag: { testids: PASSCODE_PAGE_TESTIDS, regionHtml: '' },
  });

  it('conversation 判 locked', () => {
    expect(parseXChatConversation(build('conversation'))!.status).toBe('locked');
  });

  it('inbox 判 locked(与 conversation 一致)', () => {
    expect(parseXChatInbox(build('inbox'))!.status).toBe('locked');
  });

  it('不产出任何消息 —— 解锁页的文案不能当私信', () => {
    expect(parseXChatConversation(build('conversation'))!.messages).toEqual([]);
  });

  it('这张页面本身不含登录墙特征:说明用户其实已经登录了', () => {
    // 侧边栏 testid 都在,报「去登录」是错的指引(#52 的核心抱怨)
    expect(looksLikeLoginWall(PASSCODE_PAGE_RAW_LINES, PASSCODE_PAGE_TESTIDS)).toBe(false);
    expect(PASSCODE_PAGE_TESTIDS).toContain('AppTabBar_DirectMessage_Link');
    expect(PASSCODE_PAGE_TESTIDS).toContain('SideNav_AccountSwitcher_Button');
  });
});

describe('登录墙与解锁页互不混淆', () => {
  it('登录墙仍判 needs_login', () => {
    const json = JSON.stringify({
      locked: false, needsLogin: false, messages: [], rawLines: LOGIN_WALL_RAW_LINES,
      title: '', url: '', diag: { testids: LOGIN_WALL_TESTIDS, regionHtml: '' },
    });
    expect(parseXChatConversation(json)!.status).toBe('needs_login');
  });

  it('解锁页判 locked', () => {
    const json = JSON.stringify({
      locked: false, needsLogin: false, messages: [], rawLines: PASSCODE_PAGE_RAW_LINES,
      title: '', url: '', diag: { testids: PASSCODE_PAGE_TESTIDS, regionHtml: '' },
    });
    expect(parseXChatConversation(json)!.status).toBe('locked');
  });
});
