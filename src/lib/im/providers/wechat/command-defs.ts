/**
 * WeChat Provider — Command Metadata (no deps)
 *
 * 这是 adapter.listCommands() 返回的静态数据。**不**导入 @/lib/db / 任何 server
 * 模块——因为 adapter 会被 esbuild 打包进 electron 主进程，DB 模块会拉进 native
 * binding（jieba / onnxruntime-node）esbuild 解不动。
 *
 * 实际的命令执行 (handleWechatCommand) 在 commands.ts，由 Next.js 侧的
 * dispatchInbound 调用，那边能用 DB。
 */

import type { IMCommand } from '../../core/types';
import { BUILTIN_COMMANDS } from '../../core/built-in-commands';

export const WECHAT_COMMANDS: IMCommand[] = [
  ...BUILTIN_COMMANDS,
  { name: 'list', description: '列出最近 Lumos 会话（/list <页码>）' },
  { name: 'switch', description: '已弃用：微信入口固定进入主 Agent，不再切换会话' },
  { name: 'current', description: '查看微信入口当前进入的主 Agent 会话' },
  { name: 'new', description: '已弃用：请直接让主 Agent 新建或管理会话' },
  { name: 'voice', description: '切换 AI 回复模式（/voice on|off|status；/voice native on|off）' },
  { name: 'app', description: '通用应用命令（/app <应用名或ID> status|runs|acceptance|help）' },
  { name: 'goofish', description: '闲鱼助手命令（/goofish status|unread|drafts|draft|confirm|reject|sync）' },
];
