/**
 * 进程内单例 Scraper(@the-convocation/twitter-scraper)。
 *
 * 这一层把 the-convocation 的 cookies/auth 状态收口在一处:
 *   - cookies-store.ts 持久化的 cookie 值 → 启动时灌进 scraper
 *   - scraper 内部维护 transaction-id 算法 / 当前会话 cookie / x-csrf-token
 *   - lib/x-platform/{search,timeline,auth}.ts 全部走这个单例,不直接 new Scraper
 *
 * 之前我们自己维护 GraphQL client + queryId pin + transaction-id 撞反爬撞死了,
 * 切换后这些复杂度全部转嫁给上游(2026-04 还在维护)。
 */

import { ErrorRateLimitStrategy, Scraper } from '@the-convocation/twitter-scraper';
import crossFetch from 'cross-fetch';
import { createConfiguredHttpsProxyAgentForUrl } from '@/lib/net/proxy-settings';
import {
  cookieHeader,
  hasRequiredCookies,
  readCookies,
  type XStoredCookies,
} from './cookies-store';
import { XAuthExpiredError } from './auth-error';

let scraper: Scraper | null = null;
let scraperCookieFingerprint = '';

function resolveXFetchTimeoutMs(): number {
  const raw = Number(process.env.LUMOS_X_FETCH_TIMEOUT_MS || '');
  if (!Number.isFinite(raw) || raw <= 0) return 20_000;
  return Math.max(1_000, Math.min(120_000, raw));
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function xFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  const timeoutMs = resolveXFetchTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`X fetch timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });

  try {
    const agent = createConfiguredHttpsProxyAgentForUrl(url);
    return await crossFetch(input as Parameters<typeof crossFetch>[0], {
      ...(init as Parameters<typeof crossFetch>[1]),
      signal: controller.signal,
      ...(agent ? { agent } : {}),
    });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

function fingerprint(stored: XStoredCookies | null): string {
  if (!stored) return '';
  // ct0 + auth_token 唯一标识一次登录;cookies 文件改动时重新灌入。
  return `${stored.cookies.auth_token || ''}|${stored.cookies.ct0 || ''}|${stored.savedAt}`;
}

function buildCookieStrings(stored: XStoredCookies): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(stored.cookies)) {
    if (!name || !value) continue;
    out.push(`${name}=${value}; Domain=.x.com; Path=/; Secure`);
  }
  return out;
}

/**
 * 拿到一个已经 setCookies 完毕的单例 Scraper。cookies 文件变了会自动重新注入。
 * 没有有效 cookies 直接抛 XAuthExpiredError(让上层走 401 → UI 重新登录)。
 */
export async function ensureScraper(): Promise<Scraper> {
  const stored = readCookies();
  if (!stored || !hasRequiredCookies(stored.cookies)) {
    throw new XAuthExpiredError('X 未登录或 cookie 已丢失');
  }
  const fp = fingerprint(stored);
  if (scraper && scraperCookieFingerprint === fp) return scraper;

  const next = new Scraper({
    fetch: xFetch as typeof fetch,
    rateLimitStrategy: new ErrorRateLimitStrategy(),
  });
  await next.setCookies(buildCookieStrings(stored));
  scraper = next;
  scraperCookieFingerprint = fp;
  return scraper;
}

/** 用于测试 / 检查:强制清缓存,下一次 ensureScraper 会重新创建。 */
export function resetScraperCache(): void {
  scraper = null;
  scraperCookieFingerprint = '';
}

export { cookieHeader };
