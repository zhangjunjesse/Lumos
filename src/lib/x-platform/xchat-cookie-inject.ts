// 把本地存的 X 登录 cookie 注入内置浏览器上下文。
//
// 为什么需要它(#48 的最终根因):X 登录的主路径是「粘贴 Cookie 字符串」(见 auth.ts
// 头部注释),那条路只把 cookie 写进 Node 侧的 cookies.json —— 走 HTTP 的 scraper API
// 能用,但**浏览器上下文里一个 cookie 都没有**。于是 XChat 后台页打开 x.com 永远是
// 登录墙,用户重新登录多少次都没用(他登录的动作同样只写 Node 侧)。
// 代码里此前只有 collectCookiesFromBridge(从浏览器读),没有任何反向写入。
//
// deepsearch / goofish / douyin-collector 早就在用 bridge 的 /v1/cookies/import 做这件事,
// 只有 x-platform 漏了。这里照同一套模式补上,不新增任何浏览器基础设施。

import { postToBrowserBridge, type BrowserBridgeRuntimeConfig } from '@/lib/browser-runtime/bridge-client';
import { readCookies } from './cookies-store';

interface BridgeCookie {
  url: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate: number;
}

/** X 的 cookie 同时挂在 x.com 与 twitter.com 上;两边都灌,避免跳域后掉登录态。 */
const COOKIE_DOMAINS = ['.x.com', '.twitter.com'] as const;

const COOKIE_TTL_SECONDS = 7 * 86_400;

function toBridgeCookies(cookies: Record<string, string>): BridgeCookie[] {
  const expirationDate = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const out: BridgeCookie[] = [];
  for (const [name, value] of Object.entries(cookies)) {
    if (!name || !value) continue;
    for (const domain of COOKIE_DOMAINS) {
      out.push({
        url: `https://${domain.slice(1)}/`,
        name,
        value,
        domain,
        path: '/',
        secure: true,
        // auth_token 在 X 侧是 HttpOnly;标错会和既有 session 里的同名 cookie 冲突,
        // 导致整批 import 被拒。逐条降级那步就是给这种情况兜底的。
        httpOnly: name === 'auth_token',
        expirationDate,
      });
    }
  }
  return out;
}

export interface CookieInjectResult {
  injected: number;
  total: number;
  /** 没有本地登录态时为 true —— 调用方应直接报「未登录」,不必白开一次浏览器页。 */
  noLocalCookies: boolean;
}

/**
 * 注入登录 cookie。必须在打开 XChat 页**之前**调用。
 * 失败不抛:注入不全时页面通常仍能登录,真读不到会由登录墙守卫如实报出来。
 */
export async function injectXCookiesIntoBrowser(
  config: BrowserBridgeRuntimeConfig,
  signal?: AbortSignal,
): Promise<CookieInjectResult> {
  const stored = readCookies();
  const cookies = stored?.cookies;
  if (!cookies || Object.keys(cookies).length === 0) {
    return { injected: 0, total: 0, noLocalCookies: true };
  }

  const bridgeCookies = toBridgeCookies(cookies);
  if (bridgeCookies.length === 0) return { injected: 0, total: 0, noLocalCookies: true };

  // 先批量灌(快)。一条撞上 HttpOnly 冲突就会整批失败,所以失败后逐条重来,
  // 不让一个坏条目把整批拖没 —— 与 goofish 同一套降级策略。
  try {
    await postToBrowserBridge(config, '/v1/cookies/import', { cookies: bridgeCookies }, { signal, timeoutMs: 20_000 });
    return { injected: bridgeCookies.length, total: bridgeCookies.length, noLocalCookies: false };
  } catch (error) {
    console.warn('[x-platform] 批量注入 cookie 失败,改为逐条:', error instanceof Error ? error.message : error);
  }

  let injected = 0;
  for (const cookie of bridgeCookies) {
    try {
      await postToBrowserBridge(config, '/v1/cookies/import', { cookies: [cookie] }, { signal, timeoutMs: 10_000 });
      injected += 1;
    } catch {
      // 常见:同名 cookie 已存在且 HttpOnly 标记不同。跳过 —— 部分 cookie 通常也能认证。
    }
  }
  console.log(`[x-platform] 注入 cookie ${injected}/${bridgeCookies.length} 条`);
  return { injected, total: bridgeCookies.length, noLocalCookies: false };
}
