import PQueue from 'p-queue';

/**
 * Message Queue with rate limiting
 * Ensures we don't exceed Feishu's 20 QPS limit
 */
export class MessageQueue {
  private queue: PQueue;

  constructor() {
    this.queue = new PQueue({
      concurrency: 1,
      interval: 1000,
      intervalCap: 20, // 20 QPS (Feishu API limit)
    });
  }

  /**
   * Enqueue a task with rate limiting
   */
  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return this.queue.add(task) as Promise<T>;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      size: this.queue.size,
      pending: this.queue.pending,
    };
  }

  /**
   * Clear all pending tasks
   */
  clear() {
    this.queue.clear();
  }
}
