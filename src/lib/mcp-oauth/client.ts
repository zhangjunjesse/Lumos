/**
 * OAuth 协议动作:动态注册、构造授权地址、兑换/刷新令牌。
 *
 * 这里只做协议层,不碰数据库、不碰 UI —— 便于单测,也便于以后接别的远程 MCP。
 */

import type {
  AuthServerMetadata,
  DiscoveredOAuthConfig,
  OAuthClientRegistration,
  TokenResponse,
} from './types';
import type { PkcePair } from './pkce';

const FETCH_TIMEOUT_MS = 20_000;

/** 令牌端点的错误体通常是 {error, error_description},拼成一句人能看懂的话。 */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; error_description?: string };
    const parts = [body.error_description, body.error].filter(Boolean);
    if (parts.length) return `${fallback}:${parts.join(' / ')}`;
  } catch {
    /* 非 JSON 响应,用兜底文案 */
  }
  return `${fallback}(HTTP ${res.status})`;
}

/**
 * 动态客户端注册(RFC 7591)。没有 registration_endpoint 的服务器需要用户自带
 * client_id,那种情况由调用方处理。
 */
export async function registerClient(
  metadata: AuthServerMetadata,
  redirectUri: string,
  scopes: string[],
): Promise<OAuthClientRegistration> {
  if (!metadata.registration_endpoint) {
    throw new Error(
      '这个授权服务器不支持自动注册应用,需要你先在它后台创建一个 OAuth 应用,再把 client_id 填进来。',
    );
  }
  const res = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Lumos',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // 桌面应用存不住密钥,声明为 public client
      token_endpoint_auth_method: 'none',
      ...(scopes.length ? { scope: scopes.join(' ') } : {}),
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await readError(res, '注册 OAuth 应用失败'));

  const body = (await res.json()) as { client_id?: string; client_secret?: string };
  if (!body.client_id) throw new Error('授权服务器没有返回 client_id,注册失败。');
  return { client_id: body.client_id, client_secret: body.client_secret };
}

/** 拼出让用户在浏览器里打开的授权地址。 */
export function buildAuthorizationUrl(args: {
  discovered: DiscoveredOAuthConfig;
  registration: OAuthClientRegistration;
  redirectUri: string;
  pkce: PkcePair;
  state: string;
}): string {
  const { discovered, registration, redirectUri, pkce, state } = args;
  const url = new URL(discovered.metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', registration.client_id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
  // RFC 8707:声明令牌是给哪个资源用的,避免签发出可乱用的宽泛令牌
  url.searchParams.set('resource', discovered.resource);
  if (discovered.scopes.length) url.searchParams.set('scope', discovered.scopes.join(' '));
  return url.toString();
}

async function postToken(
  tokenEndpoint: string,
  params: Record<string, string>,
  clientSecret: string | undefined,
  failureMessage: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  // 有密钥的走 client_secret_basic;public client 什么都不带
  if (clientSecret) {
    const basic = Buffer.from(`${params.client_id}:${clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
    body.delete('client_id');
  }
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await readError(res, failureMessage));

  const token = (await res.json()) as TokenResponse;
  if (!token.access_token) throw new Error(`${failureMessage}:响应里没有 access_token。`);
  return token;
}

/** 授权码换令牌。 */
export async function exchangeCodeForToken(args: {
  discovered: DiscoveredOAuthConfig;
  registration: OAuthClientRegistration;
  redirectUri: string;
  codeVerifier: string;
  code: string;
}): Promise<TokenResponse> {
  const { discovered, registration, redirectUri, codeVerifier, code } = args;
  return postToken(
    discovered.metadata.token_endpoint,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: registration.client_id,
      code_verifier: codeVerifier,
      resource: discovered.resource,
    },
    registration.client_secret,
    '兑换访问令牌失败',
  );
}

/** 用 refresh_token 续期。 */
export async function refreshAccessToken(args: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  resource: string;
}): Promise<TokenResponse> {
  return postToken(
    args.tokenEndpoint,
    {
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      resource: args.resource,
    },
    args.clientSecret,
    '刷新访问令牌失败',
  );
}
