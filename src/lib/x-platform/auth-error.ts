import { NextResponse } from 'next/server';

/**
 * 标准化的"X 登录已过期"错误码。所有 X API 路由 + GraphQL client 在识别到
 * 401 / 403 / cookie 失效 时都应该走这个码 + HTTP 401, 让前端统一拦截展示
 * "前往重新登录" 提示。
 *
 * 触发场景: X web GraphQL 在 cookie 失效时返回 `{"errors":[{"code":32}]}`
 * (Could not authenticate you), 或直接 HTTP 401 / 403。
 */
export const X_AUTH_EXPIRED = 'X_AUTH_EXPIRED';

const PATTERNS: RegExp[] = [
  /Could\s*not\s*authenticate\s*you/i,
  /Bad\s*authentication\s*data/i,
  /Authorization:\s*Status\s*is\s*a\s*duplicate/i,
  /not\s*authenticated/i,
  /not\s*authorized/i,
  /denied\s*by\s*access\s*control/i,
];

const CSRF_PATTERNS: RegExp[] = [
  /CSRF\s*token/i,
  /x-csrf-token/i,
  /ct0/i,
];

export function isXAuthExpiredMessage(text: string | undefined | null): boolean {
  if (!text) return false;
  return PATTERNS.some((re) => re.test(text)) || CSRF_PATTERNS.some((re) => re.test(text));
}

export function isXAuthExpiredError(err: unknown): boolean {
  if (!err) return false;
  const text = err instanceof Error ? err.message : String(err);
  return isXAuthExpiredMessage(text);
}

export class XAuthExpiredError extends Error {
  readonly code = X_AUTH_EXPIRED;
  constructor(message?: string) {
    super(message || 'X 登录已过期');
  }
}

export interface XAuthExpiredBody {
  ok: false;
  code: typeof X_AUTH_EXPIRED;
  message: string;
}

const FRIENDLY_MESSAGE = 'X 登录已过期，请到「服务 → X」重新登录后再试';

export function xAuthExpiredResponse(): NextResponse {
  const body: XAuthExpiredBody = {
    ok: false,
    code: X_AUTH_EXPIRED,
    message: FRIENDLY_MESSAGE,
  };
  return NextResponse.json(body, { status: 401 });
}
