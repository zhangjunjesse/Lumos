/**
 * WeChat Provider — Runtime Config (ilink protocol)
 */

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_ACCOUNT_ID = 'default';
const DEFAULT_ALLOW_FROM = '*';

export interface WechatConfig {
  token: string;
  baseUrl: string;
  accountId: string;
  allowFrom: string;
  routeTag: string;
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

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function parseWechatConfig(raw: Record<string, unknown>): WechatConfig {
  return {
    token: pickNonEmpty(raw.token as string | undefined, process.env.WECHAT_ILINK_TOKEN),
    baseUrl:
      trimTrailingSlash(
        pickNonEmpty(raw.base_url as string | undefined, process.env.WECHAT_ILINK_BASE_URL),
      ) || DEFAULT_BASE_URL,
    accountId: pickNonEmpty(raw.account_id as string | undefined) || DEFAULT_ACCOUNT_ID,
    allowFrom: pickNonEmpty(raw.allow_from as string | undefined) || DEFAULT_ALLOW_FROM,
    routeTag: pickNonEmpty(raw.route_tag as string | undefined, process.env.WECHAT_ILINK_ROUTE_TAG),
  };
}

export function isWechatConfigValid(config: WechatConfig): boolean {
  return Boolean(config.token && config.baseUrl);
}

/**
 * Check 'allow_from' permission. '*' = everyone.
 * Otherwise comma-separated list of user IDs (e.g. "user1@im.wechat,user2@im.wechat").
 */
export function isPeerAllowed(config: WechatConfig, peerUserId: string): boolean {
  const list = config.allowFrom.trim();
  if (list === '*' || list === '') return true;
  const set = new Set(list.split(',').map((s) => s.trim()).filter(Boolean));
  return set.has(peerUserId);
}
