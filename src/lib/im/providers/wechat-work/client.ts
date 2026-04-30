/**
 * WeChat Work Provider — OpenAPI Client
 *
 * 走企业微信官方 cgi-bin OpenAPI：
 *   GET /cgi-bin/gettoken?corpid=...&corpsecret=... → access_token
 *   POST /cgi-bin/message/send?access_token=...    → 发送应用消息
 *
 * Token 缓存：access_token 默认 7200s 有效，提前 5 分钟刷新。
 */

import type { WechatWorkConfig } from './config';

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface SendMessageResponse {
  errcode?: number;
  errmsg?: string;
  msgid?: string;
}

interface GetTokenResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class WechatWorkClient {
  private cache: TokenCache | null = null;

  constructor(private readonly config: WechatWorkConfig) {}

  private async getToken(): Promise<string> {
    if (this.cache && this.cache.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return this.cache.token;
    }
    const url = new URL(`${this.config.apiBase}/cgi-bin/gettoken`);
    url.searchParams.set('corpid', this.config.corpId);
    url.searchParams.set('corpsecret', this.config.corpSecret);
    const res = await fetch(url.toString());
    const data = (await res.json().catch(() => null)) as GetTokenResponse | null;
    if (!res.ok || !data?.access_token || data.errcode) {
      throw new Error(`gettoken failed: ${data?.errmsg || res.status}`);
    }
    this.cache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    };
    return this.cache.token;
  }

  async sendText(toUser: string, text: string): Promise<{ messageId?: string; error?: string }> {
    try {
      const token = await this.getToken();
      const url = `${this.config.apiBase}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: toUser,
          msgtype: 'text',
          agentid: Number(this.config.agentId),
          text: { content: text },
        }),
      });
      const data = (await res.json().catch(() => null)) as SendMessageResponse | null;
      if (!res.ok || !data || data.errcode) {
        return { error: data?.errmsg || `HTTP ${res.status}` };
      }
      return { messageId: data.msgid };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'send failed' };
    }
  }

  async probeCredentials(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.getToken();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'probe failed' };
    }
  }

  /** Test hook to reset token cache. */
  __resetTokenForTesting(): void {
    this.cache = null;
  }
}
