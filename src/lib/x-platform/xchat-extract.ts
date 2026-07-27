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

/** 现场诊断:真实 DOM 结构,供离线收敛选择器 */
export interface XChatDiag {
  testids: string[];
  regionHtml: string;
}

function parseDiag(value: unknown): XChatDiag | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const testids = Array.isArray(v.testids) ? v.testids.filter((t): t is string => typeof t === 'string') : [];
  const regionHtml = typeof v.regionHtml === 'string' ? v.regionHtml : '';
  return { testids, regionHtml };
}

export interface XChatConversationExtract {
  status: 'ok' | 'locked' | 'needs_login' | 'empty';
  messages: XChatMessage[];
  /** 结构化落空时的兜底:消息区渲染文本按行 */
  rawLines: string[];
  title: string;
  url: string;
  diag?: XChatDiag;
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
  diag?: XChatDiag;
}

// 页内脚本:读单个 XChat 会话。返回 JSON 字符串(与下方 parse 对应)。
// 选择器多路兜底 + 全程 try,坏选择器只会让对应信号缺失,不会让脚本崩。
export const XCHAT_CONVERSATION_SCRIPT = `(() => {
  const q = (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch { return []; } };
  const bodyText = ((document.body && document.body.innerText) || '');
  const lower = bodyText.toLowerCase();
  const locked = /enter your passcode|unlock chat|passcode|输入密码|解锁/i.test(bodyText);
  const needsLogin = /log in to x|sign in to x|登录\\s*到?\\s*x|登录后查看|看看正在发生什么|使用手机继续|电子邮箱或用户名|继续即表示你同意/i.test(bodyText)
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

  // 诊断:抓真实 DOM 结构,供离线收敛选择器(解析不理想时落盘)。
  const testids = Array.from(new Set(q('[data-testid]').map((el) => el.getAttribute('data-testid')).filter(Boolean))).slice(0, 120);
  const regionHtml = ((region && region.outerHTML) || '').slice(0, 40000);

  return JSON.stringify({
    locked, needsLogin, messages, rawLines,
    title: document.title, url: location.href,
    diag: { testids, regionHtml },
  });
})()`;

// 页内脚本:读 XChat 收件箱(会话列表)。
export const XCHAT_INBOX_SCRIPT = `(() => {
  const q = (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch { return []; } };
  const bodyText = ((document.body && document.body.innerText) || '');
  const locked = /enter your passcode|unlock chat|passcode|输入密码|解锁/i.test(bodyText);
  const needsLogin = /log in to x|sign in to x|登录\\s*到?\\s*x|登录后查看|看看正在发生什么|使用手机继续|电子邮箱或用户名|继续即表示你同意/i.test(bodyText)
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

  const testids = Array.from(new Set(q('[data-testid]').map((el) => el.getAttribute('data-testid')).filter(Boolean))).slice(0, 120);
  const regionHtml = ((region && region.outerHTML) || '').slice(0, 40000);

  return JSON.stringify({ locked, needsLogin, items, rawLines, diag: { testids, regionHtml } });
})()`;

/**
 * 登录墙特征。取自真实抓取的现场 DOM(#48/#49:后台页停在 JetFuel 登录页,
 * 而解析器把这些按钮文案当成了私信内容返回)。
 *
 * 页内脚本里那两条正则为什么没拦住:
 *  - 写的是 /登录到 X/,而 X 中文登录墙的标题是「登录 X」——差一个字
 *  - pathname 兜底 /\/login/ 也没用:X 在 /i/chat/<id> 上**内联**渲染登录墙,路径不变
 * 所以判定必须在这一层再做一次:纯函数、可测试、有真实 fixture 兜着。
 */
const LOGIN_WALL_PATTERNS: RegExp[] = [
  /看看正在发生什么/,
  /使用手机继续/,
  /使用\s*Google\s*继续/,
  /使用\s*Apple\s*继续/,
  /通过\s*Google\s*继续操作/,
  /电子邮箱或用户名/,
  /继续即表示你同意/,
  /log in to x|sign in to x/i,
  /登录\s*到?\s*X\b/,
  /create account|注册账号/i,
];

/** JetFuel 登录容器的 testid —— 单独出现即可定性(强特征)。 */
const LOGIN_WALL_TESTIDS = ['google_sign_in_container', 'apple_sign_in_container', 'LoginForm'];

/**
 * XChat 端到端加密的解锁页特征。来自真实现场(#51 解压出的 DOM):
 *   testids: pin-title, pin-code-input-container, pin-forgot-pin
 *   文案:Enter Passcode / Your passcode is required to recover your encryption keys…
 * 注意这时**已经登录**(侧边栏 testid 都在),只是解不开密文 —— 必须与 needs_login 区分,
 * 否则会把「去登录」这种没用的指引给到一个已经登录的用户身上。
 */
const PASSCODE_TESTIDS = ['pin-code-input-container', 'pin-title', 'pin-forgot-pin'];
const PASSCODE_PATTERNS: RegExp[] = [
  /enter passcode/i,
  /passcode is required/i,
  /recover your encryption keys/i,
  /forgot passcode/i,
  /输入密码|解锁/,
];

/** 是不是 XChat 的 passcode 解锁页(已登录但未解密)。 */
export function looksLikePasscodeGate(lines: string[], testids: string[] = []): boolean {
  if (testids.some((id) => PASSCODE_TESTIDS.includes(id))) return true;
  const text = lines.join('\n');
  if (!text.trim()) return false;
  return PASSCODE_PATTERNS.some((re) => re.test(text));
}

/**
 * 从渲染文本判断是不是登录墙。
 * 用「命中 ≥2 条特征」而不是命中一条就判——避免误杀真私信(有人聊天时确实可能提到
 * 「使用 Google 继续」)。testid 是强特征,单独命中即可。
 */
export function looksLikeLoginWall(lines: string[], testids: string[] = []): boolean {
  if (testids.some((id) => LOGIN_WALL_TESTIDS.includes(id))) return true;
  const text = lines.join('\n');
  if (!text.trim()) return false;
  let hits = 0;
  for (const re of LOGIN_WALL_PATTERNS) {
    if (re.test(text)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

function classify(
  raw: { locked?: boolean; needsLogin?: boolean },
  hasContent: boolean,
  rawLines: string[],
  testids: string[],
): 'ok' | 'locked' | 'needs_login' | 'empty' {
  // passcode 页排在最前:那时**已经登录**了,报「去登录」只会让人白折腾(#52)
  if (looksLikePasscodeGate(rawLines, testids)) return 'locked';
  if (raw.needsLogin) return 'needs_login';
  // 页内正则漏判时的第二道闸:宁可报「要登录」,也不能把界面文案当私信吐出去
  if (looksLikeLoginWall(rawLines, testids)) return 'needs_login';
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
  const diag = parseDiag(parsed.diag);
  return {
    status: classify(parsed, messages.length > 0 || rawLines.length > 0, rawLines, diag?.testids ?? []),
    messages,
    rawLines,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    url: typeof parsed.url === 'string' ? parsed.url : '',
    diag,
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
  const diag = parseDiag(parsed.diag);
  return {
    // 与 conversation 用同一个 classify:同一张登录页在两处必须给出同一个结论。
    // 过去 inbox 只看 items、conversation 还看 rawLines,于是同一故障分叉成
    // 「inbox 空数组」和「conversation 吐登录页噪音」两种症状(#48)。
    status: classify(parsed, items.length > 0, rawLines, diag?.testids ?? []),
    items,
    rawLines,
    diag,
  };
}
