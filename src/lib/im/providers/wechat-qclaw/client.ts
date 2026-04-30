/**
 * WeChat (QClaw) Provider — HTTP / WebSocket Client
 *
 * 不引入第三方 SDK，原生 fetch + ws 两个工具搞定。
 * 所有 endpoint 路径来自 QClawConfig（manifest 配置驱动），
 * 用户根据本地 QClaw 实例调整即可，代码无需变。
 */

import type { QClawConfig } from './config';

export interface QClawSendPayload {
  chatId: string;
  text: string;
  parseMode?: string;
}

export interface QClawSendResponse {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface QClawContact {
  id: string;
  name: string;
  kind?: 'direct' | 'group';
  description?: string;
}

export interface QClawIncomingEvent {
  type: 'message' | 'health' | 'unknown';
  messageId?: string;
  chatId?: string;
  userId?: string;
  text?: string;
  timestamp?: number;
  raw?: unknown;
}

export class QClawClient {
  constructor(private readonly config: QClawConfig) {}

  private buildUrl(path: string): string {
    return `${this.config.qclawHost}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.botSecret}`,
      'X-QClaw-Bot-Id': this.config.botId,
    };
  }

  async sendMessage(payload: QClawSendPayload): Promise<QClawSendResponse> {
    try {
      const res = await fetch(this.buildUrl(this.config.sendPath), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as QClawSendResponse | null;
      if (!res.ok) {
        return { ok: false, error: data?.error || `HTTP ${res.status}` };
      }
      return data ?? { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
    }
  }

  async listContacts(query?: string, limit = 50): Promise<QClawContact[]> {
    const url = new URL(this.buildUrl(this.config.contactsPath));
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    try {
      const res = await fetch(url.toString(), { headers: this.headers() });
      if (!res.ok) return [];
      const data = (await res.json().catch(() => null)) as { contacts?: QClawContact[] } | null;
      return data?.contacts ?? [];
    } catch {
      return [];
    }
  }

  async probeHealth(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(this.buildUrl(this.config.healthPath), {
        headers: this.headers(),
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'probe failed' };
    }
  }

  /**
   * 构建 WebSocket URL（含 token query）。
   * 实际握手由 monitor.ts 负责，client 只负责拼 URL + 头部。
   */
  buildEventsWsUrl(): string {
    const base = this.config.qclawHost.replace(/^http/i, 'ws');
    const url = new URL(`${base}${this.config.eventsPath}`);
    url.searchParams.set('bot_id', this.config.botId);
    url.searchParams.set('token', this.config.botSecret);
    return url.toString();
  }
}
