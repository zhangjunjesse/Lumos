/**
 * Slash Command Router
 *
 * 把 / 开头的入站消息解析成 ParsedCommand，分发给实现了 IMCommandHandler 的 adapter。
 * 命令处理后若有 reply，自动 send。
 *
 * 关键边界：
 *   - 只解析 / 开头消息；不是命令的消息原样放行
 *   - 不缓存任何状态；每次调用都是无状态
 *   - 失败不抛——任何 adapter / send 异常都吞掉，避免单条消息把 inbound 链路打挂
 */

import type {
  IMAdapter,
  IMCommandHandler,
  IMCommandResult,
  InboundMessage,
} from './types';
import { hasCommands } from './types';

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

const COMMAND_RE = /^\s*\/(\S+)(?:\s+([\s\S]*))?$/;

export function parseSlashCommand(text: string): ParsedCommand | null {
  if (!text) return null;
  const m = COMMAND_RE.exec(text);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const argText = m[2] ?? '';
  const args = argText.trim() ? argText.trim().split(/\s+/) : [];
  return { name, args, raw: text.trim() };
}

export async function routeInboundCommand(
  adapter: IMAdapter & IMCommandHandler,
  message: InboundMessage,
): Promise<{ intercepted: boolean; result?: IMCommandResult }> {
  const parsed = parseSlashCommand(message.text);
  if (!parsed) return { intercepted: false };

  let result: IMCommandResult;
  try {
    result = await adapter.handleCommand({
      command: parsed.name,
      args: parsed.args,
      message,
    });
  } catch (err) {
    // 命令处理失败时也要 ack 用户，避免静默
    const text = err instanceof Error ? err.message : 'command failed';
    try {
      await adapter.send({
        address: message.address,
        text: `❌ /${parsed.name} 失败：${text}`,
      });
    } catch { /* swallow */ }
    return { intercepted: true };
  }

  if (!result.handled) return { intercepted: false };

  if (result.reply) {
    try {
      await adapter.send(result.reply);
    } catch { /* swallow */ }
  }
  return { intercepted: true, result };
}

/**
 * Consume + route convenience. 如果 inbound 是 command 且被处理了，返回 null
 * 让调用方 fetch next；否则返回原 message 走正常聊天流程。
 */
export async function maybeInterceptCommand(
  adapter: IMAdapter,
  message: InboundMessage,
): Promise<InboundMessage | null> {
  if (!hasCommands(adapter)) return message;
  const { intercepted } = await routeInboundCommand(
    adapter as IMAdapter & IMCommandHandler,
    message,
  );
  return intercepted ? null : message;
}
