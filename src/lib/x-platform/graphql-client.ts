/**
 * X (Twitter) web GraphQL 客户端。
 *
 * x.com web app 用一个 hardcoded 静态 anonymous bearer + 用户 cookies 走
 * `https://x.com/i/api/graphql/<query_id>/<OperationName>`。x-csrf-token 必须
 * 等于 cookie 里的 ct0(double-submit pattern)。
 *
 * 这里不实现登录 — 登录在 ./auth.ts 里通过 BrowserManager bridge 拿到 cookie
 * 后写入 ./cookies-store.ts, 本文件只负责"拿了 cookie 之后怎么发 GraphQL"。
 */

import { XAuthExpiredError, isXAuthExpiredMessage } from './auth-error';
import { cookieHeader, hasRequiredCookies, readCookies } from './cookies-store';

// X.com web app 公开 hardcoded anonymous bearer。这是 web bundle 里的常量,
// 不是任何用户敏感信息 — git 上一搜就有, gist / awesome-twitter-api 都列过。
const WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const GRAPHQL_BASE = 'https://x.com/i/api/graphql';

export interface GraphQLPostInput {
  queryId: string;
  operationName: string;
  variables: Record<string, unknown>;
  features?: Record<string, boolean>;
  fieldToggles?: Record<string, boolean>;
}

export type GraphQLGetInput = GraphQLPostInput;

export type GraphQLEnvelope<T> = {
  data?: T;
  errors?: Array<{ code?: number; message?: string }>;
};

function buildHeaders(): Record<string, string> {
  const stored = readCookies();
  if (!stored || !hasRequiredCookies(stored.cookies)) {
    throw new XAuthExpiredError('X 未登录或 cookie 已丢失');
  }
  return {
    'authorization': `Bearer ${WEB_BEARER}`,
    'x-csrf-token': stored.cookies.ct0,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en',
    'cookie': cookieHeader(stored.cookies),
    'user-agent': DESKTOP_UA,
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'origin': 'https://x.com',
    'referer': 'https://x.com/',
  };
}

export async function gqlGet<T>(input: GraphQLGetInput, opts: { timeoutMs?: number } = {}): Promise<T> {
  const params = new URLSearchParams();
  params.set('variables', JSON.stringify(input.variables));
  if (input.features) params.set('features', JSON.stringify(input.features));
  if (input.fieldToggles) params.set('fieldToggles', JSON.stringify(input.fieldToggles));
  const url = `${GRAPHQL_BASE}/${input.queryId}/${input.operationName}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, { method: 'GET', headers: buildHeaders(), signal: controller.signal });
    return await readGraphQL<T>(res, input.operationName);
  } finally {
    clearTimeout(timer);
  }
}

export async function gqlPost<T>(input: GraphQLPostInput, opts: { timeoutMs?: number } = {}): Promise<T> {
  const url = `${GRAPHQL_BASE}/${input.queryId}/${input.operationName}`;
  const body = {
    variables: input.variables,
    ...(input.features ? { features: input.features } : {}),
    ...(input.fieldToggles ? { fieldToggles: input.fieldToggles } : {}),
    queryId: input.queryId,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: buildHeaders(), body: JSON.stringify(body), signal: controller.signal,
    });
    return await readGraphQL<T>(res, input.operationName);
  } finally {
    clearTimeout(timer);
  }
}

async function readGraphQL<T>(res: Response, opName: string): Promise<T> {
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new XAuthExpiredError(`X ${opName} HTTP ${res.status}`);
  }
  let envelope: GraphQLEnvelope<T>;
  try {
    envelope = JSON.parse(text) as GraphQLEnvelope<T>;
  } catch {
    throw new Error(`X ${opName}: 非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (envelope.errors && envelope.errors.length > 0) {
    const msgs = envelope.errors.map((e) => e?.message || `code=${e?.code}`).join('; ');
    if (isXAuthExpiredMessage(msgs)) {
      throw new XAuthExpiredError(`X ${opName}: ${msgs}`);
    }
    throw new Error(`X ${opName} 失败: ${msgs}`);
  }
  if (!envelope.data) {
    throw new Error(`X ${opName} 返回空 data (HTTP ${res.status})`);
  }
  return envelope.data;
}
