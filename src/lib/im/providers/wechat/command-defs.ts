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
  { name: 'list', description: '列出 lumos 会话（/list <页码>）' },
  { name: 'switch', description: '切换当前会话（/switch <编号|名字>）' },
  { name: 'current', description: '查看当前路由到哪个会话' },
  { name: 'new', description: '新建会话并设为路由目标（/new <名字>）' },
];
