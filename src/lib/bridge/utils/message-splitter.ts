/**
 * Smart message splitter that respects code block boundaries
 * Feishu has a 10000 character limit per message
 */
export class MessageSplitter {
  private readonly MAX_LENGTH = 10000;

  /**
   * Split message into chunks, respecting code block boundaries
   */
  split(text: string): string[] {
    if (text.length <= this.MAX_LENGTH) return [text];

    const chunks: string[] = [];
    let current = '';

    // Split by code blocks first
    const codeBlockRegex = /```[\s\S]*?```/g;
    const parts = this.splitByCodeBlocks(text, codeBlockRegex);

    for (const part of parts) {
      if (current.length + part.length <= this.MAX_LENGTH) {
        current += part;
      } else {
        if (current) chunks.push(current);
        // If single code block is too long, split by lines
        if (part.length > this.MAX_LENGTH) {
          chunks.push(...this.splitByLines(part));
          current = '';
        } else {
          current = part;
        }
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  /**
   * Split text by code blocks, preserving them as whole units
   */
  private splitByCodeBlocks(text: string, regex: RegExp): string[] {
    const parts: string[] = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(match[0]);
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  }

  /**
   * Split text by lines when code block is too long
   */
  private splitByLines(text: string): string[] {
    const chunks: string[] = [];
    let current = '';

    for (const line of text.split('\n')) {
      if (current.length + line.length + 1 > this.MAX_LENGTH) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? '\n' : '') + line;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }
}
