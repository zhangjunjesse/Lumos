import type { BaseChannelAdapter } from '../channel-adapter';
import type { OutboundMessage } from '../types';

interface RetryTask {
  message: OutboundMessage;
  adapter: BaseChannelAdapter;
  attempts: number;
  nextRetry: number;
}

/**
 * Retry queue for failed messages
 * Uses exponential backoff: 1s -> 2s -> 4s
 */
export class RetryQueue {
  private queue: RetryTask[] = [];
  private maxAttempts = 3;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  /**
   * Start processing retry queue
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.processQueue();
  }

  /**
   * Enqueue a failed message for retry
   */
  enqueue(message: OutboundMessage, adapter: BaseChannelAdapter) {
    this.queue.push({
      message,
      adapter,
      attempts: 0,
      nextRetry: Date.now() + 1000, // Retry after 1 second
    });
  }

  /**
   * Process retry queue
   */
  private async processQueue() {
    while (this.running) {
      const now = Date.now();
      const task = this.queue.find(t => t.nextRetry <= now);

      if (task) {
        const result = await task.adapter.send(task.message);

        if (result.ok) {
          // Success - remove from queue
          this.queue = this.queue.filter(t => t !== task);
        } else {
          // Failed - retry or give up
          task.attempts++;
          if (task.attempts >= this.maxAttempts) {
            this.queue = this.queue.filter(t => t !== task);
            console.error('[RetryQueue] Max retries exceeded:', task.message);
          } else {
            // Exponential backoff: 1s -> 2s -> 4s
            task.nextRetry = now + Math.pow(2, task.attempts) * 1000;
          }
        }
      }

      // Wait 1 second before next check
      await new Promise(resolve => {
        this.timer = setTimeout(resolve, 1000);
      });
    }
  }

  /**
   * Stop processing retry queue
   */
  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      size: this.queue.length,
      tasks: this.queue.map(t => ({
        attempts: t.attempts,
        nextRetry: t.nextRetry,
      })),
    };
  }
}
