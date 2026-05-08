import { NextResponse } from 'next/server';

/**
 * 标准化的"咸鱼登录已过期"错误码。所有 goofish API 路由在识别到 mtop session
 * 过期 / cookie 失效 时都应返回这个码 + HTTP 401，让前端可以统一拦截展示
 * "前往重新登录" 提示。
 *
 * 触发场景：goofish-cli 把淘宝 mtop 的 FAIL_SYS_SESSION_EXPIRED / Python
 * AuthRequiredError 直接抛回 stderr，旧实现把这串原文塞给用户看完全不可读。
 */
export const GOOFISH_AUTH_EXPIRED = 'GOOFISH_AUTH_EXPIRED';

const PATTERNS: RegExp[] = [
  /FAIL_SYS_SESSION_EXPIRED/i,
  /AuthRequiredError/i,
  /登录态失效/,
  /Session\s*过期/,
  /mtop\.taobao\.idlemessage\.pc\.login\.token/i,
  /illegal_session/i,
  /not\s*logged\s*in/i,
  /token\s*invalid/i,
];

export function isGoofishAuthExpiredMessage(text: string | undefined | null): boolean {
  if (!text) return false;
  return PATTERNS.some((re) => re.test(text));
}

export function isGoofishAuthExpiredError(err: unknown): boolean {
  if (!err) return false;
  const text = err instanceof Error ? err.message : String(err);
  return isGoofishAuthExpiredMessage(text);
}

export interface GoofishAuthExpiredBody {
  ok: false;
  code: typeof GOOFISH_AUTH_EXPIRED;
  message: string;
  accountUnb?: string;
}

const FRIENDLY_MESSAGE = '咸鱼登录已过期，请到「服务 → 咸鱼」重新扫码登录后再试';

export function goofishAuthExpiredResponse(opts: { accountUnb?: string } = {}): NextResponse {
  const body: GoofishAuthExpiredBody = {
    ok: false,
    code: GOOFISH_AUTH_EXPIRED,
    message: FRIENDLY_MESSAGE,
    ...(opts.accountUnb ? { accountUnb: opts.accountUnb } : {}),
  };
  return NextResponse.json(body, { status: 401 });
}
