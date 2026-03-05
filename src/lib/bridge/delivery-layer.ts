import type { BaseChannelAdapter } from './channel-adapter';
import type { OutboundMessage, SendResult } from './types';
import { MessageQueue } from './queue/message-queue';
import { MessageSplitter } from './utils/message-splitter';
import { RetryQueue } from './queue/retry-queue';

/**
 * Delivery layer with queue, rate limiting, and smart message splitting
 */
export class DeliveryLayer {
  private queue = new MessageQueue();
  private splitter = new MessageSplitter();
  private retryQueue = new RetryQueue();

  constructor() {
    this.retryQueue.start();
  }

  /**
   * Deliver message with rate limiting and smart splitting
   */
  async deliver(adapter: BaseChannelAdapter, message: OutboundMessage): Promise<SendResult> {
    return this.queue.enqueue(async () => {
      const chunks = this.splitter.split(message.text);

      for (let i = 0; i < chunks.length; i++) {
        const result = await adapter.send({ ...message, text: chunks[i] });

        if (!result.ok) {
          // Enqueue for retry
          this.retryQueue.enqueue({ ...message, text: chunks[i] }, adapter);
          return result;
        }

        // Small delay between chunks
        if (i < chunks.length - 1) {
          await this.sleep(300);
        }
      }

      return { ok: true };
    });
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queue: this.queue.getStats(),
      retry: this.retryQueue.getStats(),
    };
  }

  /**
   * Stop delivery layer
   */
  stop() {
    this.queue.clear();
    this.retryQueue.stop();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
