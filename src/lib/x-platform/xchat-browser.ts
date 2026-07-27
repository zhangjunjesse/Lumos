// XChat 浏览器读取:在已登录的浏览器上下文里后台打开 XChat 会话页,
// 等 X 页面 JS 解密渲染完,从 DOM 读消息。绕开端到端加密(不掌握设备密钥无法在
// Node 里解密),复用 Lumos browser bridge —— 与亚马逊排名助手同一套后台自动化。
//
// 全程 background:true,绝不抢用户当前可见 tab(遵守项目浏览器运行时规则)。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';
import { createBrowserBridgeApi } from '@/lib/workflow/code-browser-bridge';
import { injectXCookiesIntoBrowser } from './xchat-cookie-inject';

import {
  XCHAT_CONVERSATION_SCRIPT,
  XCHAT_INBOX_SCRIPT,
  parseXChatConversation,
  parseXChatInbox,
  type XChatConversationExtract,
  type XChatDiag,
  type XChatInboxExtract,
} from './xchat-extract';

// X 私信登录态所在的浏览器上下文(与 auth.ts 一致)。
const XCHAT_CONTEXT_ID = 'embedded:default';
const XCHAT_INBOX_URL = 'https://x.com/i/chat';
const RENDER_WAIT_MS = 4_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface XChatSession {
  read<T>(url: string, script: string, parse: (raw: unknown) => T | null): Promise<T | null>;
  close(): Promise<void>;
}

/** 判断两个 URL 是否指向同一个 XChat 目标(忽略 query/hash 与结尾斜杠)。 */
function sameXChatTarget(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const parsed = new URL(u);
      return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
    } catch {
      return u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

/** 找已经打开的 XChat 页(用户自己那个,大概率已解锁)。找不到返回 null。 */
async function findOpenXChatPage(
  api: ReturnType<typeof createBrowserBridgeApi>,
): Promise<string | null> {
  try {
    const pages = await api.pages();
    // 会话页优先于列表页:它更可能已经解锁并渲染出消息
    const chat = pages.find((p) => /\/i\/chat\/[^/?#]+/.test(p.url || ''));
    if (chat?.id) return chat.id;
    const inbox = pages.find((p) => /\/i\/chat\b/.test(p.url || ''));
    return inbox?.id ?? null;
  } catch {
    return null;
  }
}

async function openXChatSession(signal?: AbortSignal): Promise<XChatSession | { error: string }> {
  const lockOwnerId = 'x-platform:xchat';
  const config = resolveBrowserBridgeRuntimeConfig({ browserContextId: XCHAT_CONTEXT_ID, lockOwnerId });
  if (!config) {
    return { error: '浏览器未连接:请确认 Lumos 桌面端已启动(Browser Bridge 未就绪)' };
  }

  // 关键一步:先把本地 cookie 灌进浏览器上下文,再开页。
  // 「粘贴 Cookie」登录只写 Node 侧的 cookies.json,浏览器上下文一无所知 ——
  // 不注入的话这里打开的永远是登录墙(#48),而用户重新登录多少次都改变不了。
  const inject = await injectXCookiesIntoBrowser(config, signal);
  if (inject.noLocalCookies) {
    return { error: '尚未登录 X:请到「服务 → X」粘贴 Cookie 或登录后重试(本地没有任何登录 cookie)。' };
  }

  const api = createBrowserBridgeApi({
    signal,
    background: true,
    browserContextId: XCHAT_CONTEXT_ID,
    lockOwnerId,
  });

  // 优先复用**已经打开的 XChat 页**。
  // XChat 是端到端加密:4 位 passcode 是用来「恢复解密密钥」的,而那份密钥拿不到就
  // 解不开历史消息(现场 DOM 原话:"Your passcode is required to recover your
  // encryption keys so we can decrypt your previous messages")。用户在自己那个页面
  // 早就解锁过,**新开的后台页拿不到那份密钥**,所以只会停在 Enter Passcode 上(#51/#52)。
  // 复用已解锁的页就绕开了整件事,而且 selectPage 在 background 模式下只连 CDP、
  // 不切换用户可见 tab(bridge 侧注释:don't switch visible tab),不打扰界面。
  const reused = await findOpenXChatPage(api);
  let pageId = reused;
  const openedByUs = !reused;

  if (!pageId) {
    try {
      const created = await postToBrowserBridge<{ ok?: boolean; error?: string; message?: string; pageId?: string }>(
        config,
        '/v1/pages/new',
        { url: XCHAT_INBOX_URL, background: true },
        { signal, timeoutMs: 60_000 },
      );
      if (!created.pageId) return { error: '浏览器开页失败:bridge 没有返回页面 ID' };
      pageId = created.pageId;
    } catch (error) {
      return { error: `浏览器开页失败:${error instanceof Error ? error.message : String(error)}` };
    }
  }

  try {
    await api.selectPage(pageId);
  } catch (error) {
    return { error: `浏览器绑定页面失败:${error instanceof Error ? error.message : String(error)}` };
  }

  return {
    async read(url, script, parse) {
      // 复用来的页已经停在目标会话上时不要再 navigate:重新导航会丢掉它的解锁态,
      // 白白把一个能读的页面变回 Enter Passcode。
      const current = await api.currentPage().catch(() => null);
      const alreadyThere = Boolean(current?.url && sameXChatTarget(current.url, url));
      if (!alreadyThere) await api.navigate(url);
      try {
        await api.waitFor(['Message', '消息', 'Send', '发送'], { timeout: 20_000 });
      } catch {
        /* 文本等待失败不阻断,靠固定等待兜底渲染 */
      }
      await sleep(RENDER_WAIT_MS);
      const raw = await api.evaluate<string>(script).catch(() => '');
      return parse(raw);
    },
    async close() {
      // 只关我们自己开的页。复用来的是**用户自己打开的 tab**,关掉等于把人家页面收了,
      // 而且下次又得重新解锁 —— 那正是复用要避免的。
      if (openedByUs) {
        try {
          await api.closePage(pageId);
        } catch {
          /* 关页失败不影响结果 */
        }
      }
      try {
        await api.release();
      } catch {
        /* 租约释放失败不影响结果 */
      }
    },
  };
}

export interface XChatBrowserResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** 现场诊断落盘路径(解析不理想时);发我这个文件即可精确收敛选择器 */
  debugFile?: string;
}

/**
 * XChat 的 DOM 选择器无公开契约、真机未验证。解析没读到干净结构化消息时,把真实
 * DOM(testids 清单 + 消息区 outerHTML)落到本地盘,用户发来即可离线定选择器 ——
 * 一次抓现场胜过反复发版盲试。内容含私信正文,只写本机磁盘、不外发。
 */
function writeDiagBundle(kind: string, diag: XChatDiag | undefined, rawLines: string[]): string | undefined {
  if (!diag) return undefined;
  try {
    const dir = path.join(process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos'), 'x-platform', 'xchat-debug');
    fs.mkdirSync(dir, { recursive: true });
    // 固定文件名:每次覆盖,避免私信正文在磁盘堆积;用户随时取最新一次。
    const file = path.join(dir, `xchat-${kind}-latest.html`);
    const header = `<!-- testids: ${diag.testids.join(', ')} -->\n<!-- rawLines:\n${rawLines.join('\n')}\n-->\n`;
    fs.writeFileSync(file, header + diag.regionHtml, 'utf-8');
    return file;
  } catch {
    return undefined;
  }
}

async function withSession<T>(
  run: (session: XChatSession) => Promise<T | null>,
  signal?: AbortSignal,
): Promise<XChatBrowserResult<T>> {
  const opened = await openXChatSession(signal);
  if ('error' in opened) return { ok: false, error: opened.error };
  try {
    const data = await run(opened);
    if (!data) return { ok: false, error: 'XChat 页面无法解析(未渲染或结构变化)' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await opened.close();
  }
}

export async function readXChatInbox(signal?: AbortSignal): Promise<XChatBrowserResult<XChatInboxExtract>> {
  const res = await withSession((s) => s.read(XCHAT_INBOX_URL, XCHAT_INBOX_SCRIPT, parseXChatInbox), signal);
  if (res.ok && res.data && res.data.items.length === 0) {
    res.debugFile = writeDiagBundle('inbox', res.data.diag, res.data.rawLines);
  }
  return res;
}

export async function readXChatConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<XChatBrowserResult<XChatConversationExtract>> {
  const url = `${XCHAT_INBOX_URL}/${encodeURIComponent(conversationId)}`;
  const res = await withSession((s) => s.read(url, XCHAT_CONVERSATION_SCRIPT, parseXChatConversation), signal);
  if (res.ok && res.data && res.data.messages.length === 0) {
    res.debugFile = writeDiagBundle('conversation', res.data.diag, res.data.rawLines);
  }
  return res;
}
