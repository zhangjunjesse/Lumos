/**
 * WeChat Work Provider — Runtime Config
 */

export interface WechatWorkConfig {
  corpId: string;
  agentId: string;
  corpSecret: string;
  callbackToken: string;
  callbackAesKey: string;
  apiBase: string;
}

const DEFAULT_API_BASE = 'https://qyapi.weixin.qq.com';

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

export function parseWechatWorkConfig(raw: Record<string, unknown>): WechatWorkConfig {
  return {
    corpId: pickNonEmpty(raw.corp_id as string | undefined, process.env.WECHAT_WORK_CORP_ID),
    agentId: pickNonEmpty(raw.agent_id as string | undefined, process.env.WECHAT_WORK_AGENT_ID),
    corpSecret: pickNonEmpty(
      raw.corp_secret as string | undefined,
      process.env.WECHAT_WORK_CORP_SECRET,
    ),
    callbackToken: pickNonEmpty(raw.callback_token as string | undefined),
    callbackAesKey: pickNonEmpty(raw.callback_aes_key as string | undefined),
    apiBase: trimTrailingSlash(
      pickNonEmpty(raw.api_base as string | undefined, process.env.WECHAT_WORK_API_BASE) ||
        DEFAULT_API_BASE,
    ),
  };
}

export function isWechatWorkConfigValid(config: WechatWorkConfig): boolean {
  return Boolean(config.corpId && config.agentId && config.corpSecret);
}
