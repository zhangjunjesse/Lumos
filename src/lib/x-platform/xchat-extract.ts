// XChat 页面提取:纯逻辑 + 页内脚本。
//
// 背景:X 把私信迁到了 XChat(端到端加密,/i/chat 路由)。老 /1.1/dm API 读不到
// 已迁移账号的消息正文。XChat 的解密由 X 自己的页面 JS 在浏览器里完成 —— 所以我们
// 不重写加密,而是在已登录的浏览器上下文里打开会话页,等它渲染完,从 DOM 读。
//
// ⚠️ XChat 的 DOM 选择器无公开契约,这里的 data-testid 是基于 X 历史规律的最佳猜测,
// 必须在真实 XChat 账号上验证后收敛(见 #45)。所以每个提取都带 rawLines 文本兜底:
// 即使结构化选择器全部落空,也能把渲染出来的文本交给上层/AI,不至于假装"没有消息"。

export interface XChatMessage {
  text: string;
  /** 是否本人发出;拿不准为 null */
  outgoing: boolean | null;
}

export interface XChatConversationExtract {
  status: 'ok' | 'locked' | 'needs_login' | 'empty';
  messages: XChatMessage[];
  /** 结构化落空时的兜底:消息区渲染文本按行 */
  rawLines: string[];
  title: string;
  url: string;
}

export interface XChatInboxItem {
  conversationId: string;
  name: string;
  preview: string;
}

export interface XChatInboxExtract {
  status: 'ok' | 'locked' | 'needs_login' | 'empty';
  items: XChatInboxItem[];
  rawLines: string[];
}

// 页内脚本:读单个 XChat 会话。返回 JSON 字符串(与下方 parse 对应)。
// 选择器多路兜底 + 全程 try,坏选择器只会让对应信号缺失,不会让脚本崩。
export const XCHAT_CONVERSATION_SCRIPT = `(() => {
  const q = (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch { return []; } };
  const bodyText = ((document.body && document.body.innerText) || '');
  const lower = bodyText.toLowerCase();
  const locked = /enter your passcode|unlock chat|passcode|输入密码|解锁/i.test(bodyText);
  const needsLogin = /log in to x|sign in to x|登录到 x|登录后查看/i.test(bodyText)
    || /\\/login|\\/i\\/flow\\/login/.test(location.pathname);

  const rowSelectors = [
    '[data-testid="messageEntry"]',
    '[data-testid="DmScrollerContainer"] [role="row"]',
    '[data-testid="cellInnerDiv"]',
    'div[role="row"]',
  ];
  let rows = [];
  for (const sel of rowSelectors) { const r = q(sel); if (r.length) { rows = r; break; } }

  const messages = [];
  for (const row of rows) {
    const text = (row.innerText || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    let outgoing = null;
    try {
      const cs = getComputedStyle(row);
      if (cs.textAlign === 'right' || cs.justifyContent === 'flex-end') outgoing = true;
      const inner = row.querySelector('[style*="flex-end"], [style*="right"]');
      if (inner) outgoing = true;
    } catch {}
    messages.push({ text: text.slice(0, 2000), outgoing });
  }

  const region = document.querySelector('[data-testid="DmScrollerContainer"]')
    || document.querySelector('main') || document.body;
  const rawLines = ((region && region.innerText) || '')
    .split('\\n').map((s) => s.trim()).filter(Boolean).slice(0, 200);

  return JSON.stringify({
    locked, needsLogin, messages, rawLines,
    title: document.title, url: location.href,
  });
})()`;

// 页内脚本:读 XChat 收件箱(会话列表)。
export const XCHAT_INBOX_SCRIPT = `(() => {
  const q = (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch { return []; } };
  const bodyText = ((document.body && document.body.innerText) || '');
  const locked = /enter your passcode|unlock chat|passcode|输入密码|解锁/i.test(bodyText);
  const needsLogin = /log in to x|sign in to x|登录到 x/i.test(bodyText)
    || /\\/login|\\/i\\/flow\\/login/.test(location.pathname);

  const cellSelectors = [
    '[data-testid="conversation"]',
    '[data-testid="DMConversation"]',
    'a[href*="/i/chat/"]',
    'a[href*="/messages/"]',
  ];
  let cells = [];
  for (const sel of cellSelectors) { const c = q(sel); if (c.length) { cells = c; break; } }

  const items = [];
  const seen = new Set();
  for (const cell of cells) {
    const link = cell.matches('a[href]') ? cell : cell.querySelector('a[href*="/chat/"], a[href*="/messages/"]');
    const href = link ? (link.getAttribute('href') || '') : '';
    const m = href.match(/\\/(?:i\\/chat|messages)\\/([0-9-]+)/);
    const conversationId = m ? m[1] : '';
    const text = (cell.innerText || '').replace(/\\s+/g, ' ').trim();
    const key = conversationId || text;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const parts = text.split(/\\s{2,}|\\n/).map((s) => s.trim()).filter(Boolean);
    items.push({ conversationId, name: parts[0] || '', preview: parts.slice(1).join(' ').slice(0, 200) });
  }

  const region = document.querySelector('[data-testid="DMDrawer"]')
    || document.querySelector('main') || document.body;
  const rawLines = ((region && region.innerText) || '')
    .split('\\n').map((s) => s.trim()).filter(Boolean).slice(0, 200);

  return JSON.stringify({ locked, needsLogin, items, rawLines });
})()`;

function classify(raw: { locked?: boolean; needsLogin?: boolean }, hasContent: boolean):
  'ok' | 'locked' | 'needs_login' | 'empty' {
  if (raw.needsLogin) return 'needs_login';
  if (raw.locked) return 'locked';
  return hasContent ? 'ok' : 'empty';
}

export function parseXChatConversation(rawJson: unknown): XChatConversationExtract | null {
  if (typeof rawJson !== 'string' || !rawJson.trim()) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const messages: XChatMessage[] = Array.isArray(parsed.messages)
    ? (parsed.messages as Array<Record<string, unknown>>)
        .filter((m) => typeof m?.text === 'string' && (m.text as string).trim())
        .map((m) => ({
          text: (m.text as string).trim(),
          outgoing: typeof m.outgoing === 'boolean' ? (m.outgoing as boolean) : null,
        }))
    : [];
  const rawLines = Array.isArray(parsed.rawLines)
    ? (parsed.rawLines as unknown[]).filter((l): l is string => typeof l === 'string')
    : [];
  return {
    status: classify(parsed, messages.length > 0 || rawLines.length > 0),
    messages,
    rawLines,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    url: typeof parsed.url === 'string' ? parsed.url : '',
  };
}

export function parseXChatInbox(rawJson: unknown): XChatInboxExtract | null {
  if (typeof rawJson !== 'string' || !rawJson.trim()) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const items: XChatInboxItem[] = Array.isArray(parsed.items)
    ? (parsed.items as Array<Record<string, unknown>>)
        .filter((it) => typeof it?.name === 'string' || typeof it?.conversationId === 'string')
        .map((it) => ({
          conversationId: typeof it.conversationId === 'string' ? it.conversationId : '',
          name: typeof it.name === 'string' ? it.name : '',
          preview: typeof it.preview === 'string' ? it.preview : '',
        }))
    : [];
  const rawLines = Array.isArray(parsed.rawLines)
    ? (parsed.rawLines as unknown[]).filter((l): l is string => typeof l === 'string')
    : [];
  return {
    status: classify(parsed, items.length > 0),
    items,
    rawLines,
  };
}
