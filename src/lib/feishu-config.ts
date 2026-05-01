import { getSetting, setSetting } from '@/lib/db';

// ----------------------------------------------------------------------------
// IM 模块迁移期间的 dual-read / dual-write
//
// M2 起 Feishu 桥接代码迁到 src/lib/im/providers/feishu/，配置走 im.feishu.* 命名空间。
// 旧 settings key（feishu_app_id 等）继续保留以便回退。
// 读取时优先 new，回退 legacy；写入时双写。
// ----------------------------------------------------------------------------
const LEGACY_TO_IM_KEY: Record<string, string> = {
  feishu_app_id: 'im.feishu.app_id',
  feishu_app_secret: 'im.feishu.app_secret',
  feishu_redirect_uri: 'im.feishu.redirect_uri',
  feishu_oauth_scopes: 'im.feishu.oauth_scopes',
};

function readDualKey(legacyKey: string): string {
  const newKey = LEGACY_TO_IM_KEY[legacyKey];
  if (newKey) {
    const fromNew = getSetting(newKey);
    if (fromNew && fromNew.trim()) return fromNew;
  }
  return getSetting(legacyKey) || '';
}

/**
 * Persist a Feishu setting to both the legacy key and the new im.feishu.* key.
 * 回调路由（PUT /api/feishu/config）和 OAuth 流程都应通过这个写入，
 * 保证新旧路径读取一致。
 */
export function writeFeishuSetting(legacyKey: string, value: string): void {
  setSetting(legacyKey, value);
  const newKey = LEGACY_TO_IM_KEY[legacyKey];
  if (newKey) setSetting(newKey, value);
}

const DEFAULT_FEISHU_REDIRECT_URI = 'http://localhost:43127/api/feishu/auth/callback';

export const DEFAULT_FEISHU_OAUTH_SCOPES = [
  'offline_access',
  'wiki:wiki',
  'docx:document',
  'docx:document.block:convert',
  'drive:drive',
  'mail:user_mailbox.message:send',
  'contact:user.base:readonly',
  'contact:user.email:readonly',
].join(' ');

export interface FeishuStoredSettings {
  appId: string;
  appSecret: string;
  redirectUri: string;
  oauthScopes: string;
}

function pickNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function normalizeLoopbackOrigin(origin?: string): string {
  if (!origin) return '';

  try {
    const url = new URL(origin);
    if (url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]') {
      url.hostname = 'localhost';
    }
    return url.origin;
  } catch {
    return origin.trim().replace(/\/+$/, '');
  }
}

function normalizeRedirectUri(uri?: string): string {
  if (!uri) return '';

  try {
    const url = new URL(uri);
    if (url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]') {
      url.hostname = 'localhost';
    }
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return uri.trim().replace(/\/+$/, '');
  }
}

export function getStoredFeishuSettings(): FeishuStoredSettings {
  return {
    appId: pickNonEmpty(readDualKey('feishu_app_id')),
    appSecret: pickNonEmpty(readDualKey('feishu_app_secret')),
    redirectUri: pickNonEmpty(readDualKey('feishu_redirect_uri')),
    oauthScopes: pickNonEmpty(readDualKey('feishu_oauth_scopes')),
  };
}

export function getFeishuCredentials(): { appId: string; appSecret: string } {
  const stored = getStoredFeishuSettings();
  return {
    appId: pickNonEmpty(stored.appId, process.env.FEISHU_APP_ID),
    appSecret: pickNonEmpty(stored.appSecret, process.env.FEISHU_APP_SECRET),
  };
}

export function getFeishuOAuthScopes(): string {
  const stored = getStoredFeishuSettings();
  return pickNonEmpty(
    stored.oauthScopes,
    process.env.FEISHU_OAUTH_SCOPES,
    DEFAULT_FEISHU_OAUTH_SCOPES,
  );
}

export function resolveFeishuRedirectUri(requestOrigin?: string): string {
  const stored = getStoredFeishuSettings();
  const storedRedirectUri = pickNonEmpty(stored.redirectUri);
  const envRedirectUri = pickNonEmpty(process.env.FEISHU_REDIRECT_URI);
  const configuredRedirectUri = pickNonEmpty(storedRedirectUri, envRedirectUri);

  if (configuredRedirectUri) {
    const normalizedOrigin = normalizeLoopbackOrigin(requestOrigin);
    if (normalizedOrigin && storedRedirectUri && !envRedirectUri) {
      const originRedirectUri = `${normalizedOrigin}/api/feishu/auth/callback`;
      const normalizedConfigured = normalizeRedirectUri(storedRedirectUri);
      const normalizedLegacyDefault = normalizeRedirectUri(DEFAULT_FEISHU_REDIRECT_URI);
      const normalizedOriginRedirect = normalizeRedirectUri(originRedirectUri);

      // Treat the historical default as a placeholder so dev-origin callbacks work without manual rewrites.
      if (
        normalizedConfigured === normalizedLegacyDefault &&
        normalizedConfigured !== normalizedOriginRedirect
      ) {
        return originRedirectUri;
      }
    }

    return configuredRedirectUri;
  }

  const normalizedOrigin = normalizeLoopbackOrigin(requestOrigin);
  if (normalizedOrigin) {
    return `${normalizedOrigin}/api/feishu/auth/callback`;
  }

  return DEFAULT_FEISHU_REDIRECT_URI;
}

export function isFeishuConfigured(): boolean {
  const { appId, appSecret } = getFeishuCredentials();
  return Boolean(appId && appSecret);
}

export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length);
  return `***${trimmed.slice(-8)}`;
}
