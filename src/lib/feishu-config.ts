import { getSetting } from '@/lib/db';

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
    appId: pickNonEmpty(getSetting('feishu_app_id')),
    appSecret: pickNonEmpty(getSetting('feishu_app_secret')),
    redirectUri: pickNonEmpty(getSetting('feishu_redirect_uri')),
    oauthScopes: pickNonEmpty(getSetting('feishu_oauth_scopes')),
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
