import type { BaseChannelAdapter } from './channel-adapter';
import type { OutboundMessage, SendResult } from './types';

export class DeliveryLayer {
  private rateLimiter = new Map<string, number>();

  async deliver(adapter: BaseChannelAdapter, message: OutboundMessage): Promise<SendResult> {
    await this.rateLimit(message.address.chatId);
    const chunks = this.splitMessage(message.text, 8000);

    for (let i = 0; i < chunks.length; i++) {
      const result = await adapter.send({ ...message, text: chunks[i] });
      if (!result.ok) {
        const retry = await this.retry(adapter, { ...message, text: chunks[i] });
        if (!retry.ok) return retry;
      }
      if (i < chunks.length - 1) await this.sleep(300);
    }

    return { ok: true };
  }

  private async rateLimit(chatId: string): Promise<void> {
    const now = Date.now();
    const last = this.rateLimiter.get(chatId) || 0;
    const wait = Math.max(0, 50 - (now - last));
    if (wait > 0) await this.sleep(wait);
    this.rateLimiter.set(chatId, Date.now());
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let current = '';
    for (const line of text.split('\n')) {
      if (current.length + line.length + 1 > maxLength) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? '\n' : '') + line;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private async retry(adapter: BaseChannelAdapter, message: OutboundMessage, attempt = 0): Promise<SendResult> {
    if (attempt >= 3) return { ok: false, error: 'Max retries exceeded' };
    await this.sleep(Math.pow(2, attempt) * 1000);
    const result = await adapter.send(message);
    return result.ok ? result : this.retry(adapter, message, attempt + 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
