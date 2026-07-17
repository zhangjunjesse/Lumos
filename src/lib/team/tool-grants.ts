// 成员能力授权 → SDK disallowedTools(平台团队会话的安全闸门)。
// 团队成员继承会话的全部工具(office/浏览器/知识库/飞书等 MCP + skill,与普通聊天一致),
// 权限档位只用来"拦危险项":无 exec 挡命令执行,无 write 挡写文件/出图。
// (团队会话 bypassPermissions 跑,控制协议回调不可靠,见 docs/chat-team-design.md §5.2;
//  声明式的 disallowedTools 是唯一可靠的过滤面。)

import { LUMOS_MCP_SERVER_NAME } from '@/lib/tools/lumos-mcp-server';
import type { AgentPresetToolPermissions } from '@/types';

export const TEAM_IMAGE_TOOL = `mcp__${LUMOS_MCP_SERVER_NAME}__generate_image`;

// 危险/花钱的内置动作——按档位挡掉;MCP 能力(office/浏览器/知识库…)不在此列,成员默认可用。
const EXEC_TOOLS = ['Bash'];
const PRODUCE_TOOLS = ['Write', 'Edit', TEAM_IMAGE_TOOL];

/** 缺省授权:只开读研(人设没配 toolPermissions 时的安全缺省)。 */
export const DEFAULT_TOOL_PERMISSIONS: AgentPresetToolPermissions = { read: true, write: false, exec: false };

/** 按权限档位算出该成员要禁用的工具(继承全部之上做减法)。 */
export function grantsToDisallowedTools(perms: AgentPresetToolPermissions | undefined): string[] {
  const p = perms ?? DEFAULT_TOOL_PERMISSIONS;
  const disallowed: string[] = [];
  if (!p.exec) disallowed.push(...EXEC_TOOLS);
  if (!p.write) disallowed.push(...PRODUCE_TOOLS);
  return disallowed;
}
