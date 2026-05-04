/**
 * Feishu Provider — Runtime Config
 *
 * 把从 core/config-store 拿到的 raw record 解析成强类型 FeishuConfig，
 * 同时兜底 env 变量（FEISHU_APP_ID / FEISHU_APP_SECRET / ...）。
 *
 * 所有 provider 内部用 FeishuConfig；只有这个文件知道字段名怎么映射。
 */

import { DEFAULT_FEISHU_OAUTH_SCOPES } from './manifest';

export type FeishuDomain = 'feishu' | 'lark';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
  redirectUri: string;
  oauthScopes: string;
}

function pickNonEmpty(...values: Array<string | undefined>): string {
  for (const v of values) {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function normalizeDomain(value: unknown): FeishuDomain {
  return value === 'lark' ? 'lark' : 'feishu';
}

export function parseFeishuConfig(raw: Record<string, unknown>): FeishuConfig {
  return {
    appId: pickNonEmpty(raw.app_id as string | undefined, process.env.FEISHU_APP_ID),
    appSecret: pickNonEmpty(raw.app_secret as string | undefined, process.env.FEISHU_APP_SECRET),
    domain: normalizeDomain(raw.domain),
    redirectUri: pickNonEmpty(raw.redirect_uri as string | undefined, process.env.FEISHU_REDIRECT_URI),
    oauthScopes: pickNonEmpty(
      raw.oauth_scopes as string | undefined,
      process.env.FEISHU_OAUTH_SCOPES,
      DEFAULT_FEISHU_OAUTH_SCOPES,
    ),
  };
}

export function isFeishuConfigValid(config: FeishuConfig): boolean {
  return Boolean(config.appId && config.appSecret);
}

export function maskFeishuSecret(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length);
  return `***${trimmed.slice(-8)}`;
}
