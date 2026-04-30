/**
 * Feishu Provider — SDK Client Wrapper
 *
 * 封装 @larksuiteoapi/node-sdk 的 REST + WebSocket 两个 client。
 * 只暴露 IM 桥接需要的窄 API；非 IM 用途（同步、文档、企微桥接同步辅助）
 * 仍走原有的 src/lib/bridge/adapters/feishu-api.ts，互不干扰。
 */

import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig, FeishuDomain } from './config';

function resolveLarkDomain(domain: FeishuDomain): lark.Domain {
  return domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
}

export class FeishuClient {
  private restClient: lark.Client | null = null;
  private wsClient: lark.WSClient | null = null;

  constructor(private readonly config: FeishuConfig) {}

  ensureRest(): lark.Client {
    if (!this.restClient) {
      this.restClient = new lark.Client({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        domain: resolveLarkDomain(this.config.domain),
      });
    }
    return this.restClient;
  }

  /**
   * 启动 WebSocket 长连接。dispatcher 由 monitor.ts 提供。
   */
  startWebSocket(dispatcher: lark.EventDispatcher): void {
    if (this.wsClient) return;
    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: resolveLarkDomain(this.config.domain),
    });
    this.wsClient.start({ eventDispatcher: dispatcher });
  }

  stopWebSocket(): void {
    if (!this.wsClient) return;
    this.wsClient.close({ force: true });
    this.wsClient = null;
  }

  reset(): void {
    this.stopWebSocket();
    this.restClient = null;
  }

  /**
   * 走 REST 发送 text 消息（IMAdapter.send 的默认路径）。
   */
  async sendText(chatId: string, text: string): Promise<{ messageId?: string; error?: string }> {
    const res = await this.ensureRest().im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
    if (res?.data?.message_id) return { messageId: res.data.message_id };
    return { error: res?.msg || 'send failed' };
  }

  /**
   * Probe：拉一次 tenant_access_token 验证凭据可用。
   * 不直接调用 lark.Client 的内部 token 接口（API 不稳定），用 fetch 直接打凭据接口。
   */
  async probeCredentials(): Promise<{ ok: boolean; error?: string }> {
    const baseUrl = this.config.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
    try {
      const res = await fetch(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
      });
      const data = (await res.json().catch(() => null)) as { code?: number; msg?: string } | null;
      if (!res.ok || (data && data.code !== 0)) {
        return { ok: false, error: data?.msg || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'probe failed' };
    }
  }
}
