/**
 * 命令处理器
 */

import type { Command } from './command-parser';

export interface CommandContext {
  sessionId: string;
  chatId: string;
}

export type CommandHandler = (cmd: Command, ctx: CommandContext) => Promise<string>;

export const commandHandlers: Record<string, CommandHandler> = {
  help: async () => `📚 **Lumos 命令帮助**

**基础命令**
• /help - 显示此帮助信息
• /clear - 清空当前会话历史
• /status - 显示当前状态

**提示**: 直接发送消息即可与 AI 对话`,

  clear: async (cmd, ctx) => {
    // TODO: 实现清空会话逻辑
    return '✅ 会话历史已清空';
  },

  status: async (cmd, ctx) => {
    return `📊 **当前状态**\n会话ID: ${ctx.sessionId}`;
  }
};

export async function executeCommand(
  command: Command,
  context: CommandContext
): Promise<string> {
  const handler = commandHandlers[command.name];

  if (!handler) {
    return `❌ 未知命令: ${command.name}\n\n使用 /help 查看可用命令`;
  }

  try {
    return await handler(command, context);
  } catch (error) {
    return `❌ 命令执行失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}
