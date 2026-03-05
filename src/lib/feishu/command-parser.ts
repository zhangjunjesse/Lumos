/**
 * 命令解析器
 */

export interface Command {
  name: string;
  args: string[];
  rawText: string;
}

export function parseCommand(text: string): Command | null {
  if (!text.startsWith('/')) {
    return null;
  }

  const parts = text.slice(1).trim().split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1);

  return { name, args, rawText: text };
}
