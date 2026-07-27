// X 登录 cookie 注入浏览器上下文的回归(#48 最终根因)。
//
// 病史:X 登录主路径是「粘贴 Cookie 字符串」,只写 Node 侧 cookies.json —— 走 HTTP 的
// scraper 能用,但浏览器上下文里一个 cookie 都没有。于是 XChat 后台页永远停在登录墙,
// 用户重新登录多少次都没用(登录动作同样只写 Node 侧)。
// deepsearch/goofish/douyin 早就在用 bridge 的 /v1/cookies/import,只有 x-platform 漏了。

const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let postShouldFail: (path: string, body: Record<string, unknown>) => boolean = () => false;

jest.mock('@/lib/browser-runtime/bridge-client', () => ({
  postToBrowserBridge: jest.fn(async (_cfg: unknown, p: string, body: Record<string, unknown>) => {
    posts.push({ path: p, body });
    if (postShouldFail(p, body)) throw new Error('HttpOnly conflict');
    return { ok: true };
  }),
}));

let storedCookies: Record<string, string> | null = null;
jest.mock('../cookies-store', () => ({
  readCookies: () => (storedCookies ? { cookies: storedCookies } : null),
}));

import { injectXCookiesIntoBrowser } from '../xchat-cookie-inject';

const config = { baseUrl: 'http://127.0.0.1:1', token: 't' } as never;

beforeEach(() => {
  posts.length = 0;
  postShouldFail = () => false;
  storedCookies = { auth_token: 'A', ct0: 'B', twid: 'u%3D123' };
});

describe('injectXCookiesIntoBrowser', () => {
  it('把本地 cookie 灌进浏览器 —— 这一步过去完全没有,是 #48 的根因', async () => {
    const r = await injectXCookiesIntoBrowser(config);
    expect(r.noLocalCookies).toBe(false);
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/v1/cookies/import');
  });

  it('x.com 与 twitter.com 两个域都灌,避免跳域掉登录态', async () => {
    await injectXCookiesIntoBrowser(config);
    const cookies = posts[0].body.cookies as Array<{ name: string; domain: string; url: string }>;
    const domains = new Set(cookies.map((c) => c.domain));
    expect(domains).toEqual(new Set(['.x.com', '.twitter.com']));
    expect(cookies.filter((c) => c.name === 'auth_token')).toHaveLength(2);
    expect(cookies.find((c) => c.domain === '.x.com')!.url).toBe('https://x.com/');
  });

  it('auth_token 标成 HttpOnly(X 侧就是),其余不标', async () => {
    await injectXCookiesIntoBrowser(config);
    const cookies = posts[0].body.cookies as Array<{ name: string; httpOnly: boolean }>;
    expect(cookies.find((c) => c.name === 'auth_token')!.httpOnly).toBe(true);
    expect(cookies.find((c) => c.name === 'ct0')!.httpOnly).toBe(false);
  });

  it('本地没有 cookie 时直接报 noLocalCookies,不去白开浏览器页', async () => {
    storedCookies = null;
    const r = await injectXCookiesIntoBrowser(config);
    expect(r.noLocalCookies).toBe(true);
    expect(posts).toHaveLength(0);
  });

  it('批量失败时逐条重来 —— 一个坏条目不能把整批拖没', async () => {
    let first = true;
    postShouldFail = (_p, body) => {
      const n = (body.cookies as unknown[]).length;
      if (n > 1 && first) { first = false; return true; } // 只让第一次批量失败
      return false;
    };
    const r = await injectXCookiesIntoBrowser(config);
    // 1 次批量(失败)+ 6 次逐条(3 个 cookie × 2 个域)
    expect(posts).toHaveLength(7);
    expect(r.injected).toBe(6);
  });

  it('逐条时个别失败也不抛,按实际成功数上报', async () => {
    postShouldFail = (_p, body) => {
      const cookies = body.cookies as Array<{ name: string }>;
      return cookies.length > 1 || cookies[0].name === 'auth_token';
    };
    const r = await injectXCookiesIntoBrowser(config);
    expect(r.injected).toBe(4); // 6 条里 auth_token 的 2 条失败
    expect(r.total).toBe(6);
  });

  it('空值 cookie 被跳过', async () => {
    storedCookies = { auth_token: 'A', ct0: '' };
    await injectXCookiesIntoBrowser(config);
    const cookies = posts[0].body.cookies as Array<{ name: string }>;
    expect(cookies.every((c) => c.name === 'auth_token')).toBe(true);
  });
});
