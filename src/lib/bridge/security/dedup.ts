export class MessageDeduplicator {
  private seen = new Set<string>();
  private maxSize = 1000;

  isDuplicate(messageId: string): boolean {
    if (this.seen.has(messageId)) return true;
    this.seen.add(messageId);
    if (this.seen.size > this.maxSize) {
      const first = this.seen.values().next().value;
      this.seen.delete(first!);
    }
    return false;
  }
}
