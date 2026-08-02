// 团队管家工具的共享件。抽出来是为了让成员/团队工具与部门工具能各自成文件
// 而不互相 import(否则 mcp-server 与 org-tools 会形成循环依赖)。

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(error: unknown): CallToolResult {
  const msg = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: msg }, null, 2) }], isError: true };
}

export const permissionsSchema = z.object({
  read: z.boolean().optional().describe('读取与调研(读文件/网络搜索)。缺省 true。'),
  write: z.boolean().optional().describe('产出(写文件/出图,可能花钱)。缺省 false,需用户同意。'),
  exec: z.boolean().optional().describe('执行命令(可运行任意命令,高风险)。缺省 false,需用户明确同意。'),
}).describe('成员在团队协作中的工具权限;缺省只给 read。');
