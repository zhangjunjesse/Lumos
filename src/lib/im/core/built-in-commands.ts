/**
 * Built-in Commands
 *
 * 任何 provider 实现 IMCommandHandler 时可以复用这套基础命令。
 * 调用方式：在 adapter.handleCommand 里先 try handleBuiltinCommand，
 * 没命中再走自定义命令逻辑。
 *
 * 当前内置：
 *   /help          列出可用命令
 *   /ping          回 pong（健康检查）
 *   /whoami        返回 chat / user 信息（debug 用）
 */

import type { IMCommand, IMCommandContext, IMCommandResult } from './types';

export const BUILTIN_COMMANDS: IMCommand[] = [
  { name: 'help', description: '列出此 IM 支持的命令', aliases: ['?'] },
  { name: 'ping', description: '健康检查 — 回复 pong' },
  { name: 'whoami', description: '查看当前 chat / user 元数据' },
];

export async function handleBuiltinCommand(
  ctx: IMCommandContext,
  providerLabel: string,
  extraCommands: IMCommand[] = [],
): Promise<IMCommandResult | null> {
  const cmd = ctx.command.toLowerCase();

  if (cmd === 'ping') {
    return {
      handled: true,
      reply: { address: ctx.message.address, text: 'pong' },
    };
  }

  if (cmd === 'help' || cmd === '?') {
    const all = [...BUILTIN_COMMANDS, ...extraCommands];
    const lines = all.map((c) => `/${c.name} — ${c.description}`).join('\n');
    return {
      handled: true,
      reply: {
        address: ctx.message.address,
        text: `${providerLabel} 命令：\n${lines}`,
      },
    };
  }

  if (cmd === 'whoami') {
    const a = ctx.message.address;
    const lines = [
      `provider: ${a.providerId}`,
      `chatId:   ${a.chatId}`,
      `userId:   ${a.userId || '(unknown)'}`,
    ];
    return {
      handled: true,
      reply: { address: a, text: lines.join('\n') },
    };
  }

  return null;
}
