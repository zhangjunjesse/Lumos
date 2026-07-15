// 成员能力授权 → SDK 声明式工具清单(平台团队会话唯一的权限控制面)。
// 团队会话 bypassPermissions 跑(控制协议回调不可靠,见 docs/chat-team-design.md §5.2/5.3),
// 所以这里的映射就是安全闸门本身:读研缺省开,产出/执行必须显式授予。

import { LUMOS_MCP_SERVER_NAME } from '@/lib/tools/lumos-mcp-server';
import type { AgentPresetToolPermissions } from '@/types';

export const TEAM_IMAGE_TOOL = `mcp__${LUMOS_MCP_SERVER_NAME}__generate_image`;

const RESEARCH_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
const PRODUCE_TOOLS = ['Write', 'Edit', TEAM_IMAGE_TOOL];
const EXEC_TOOLS = ['Bash'];

/** 缺省授权:只开读研(人设没配 toolPermissions 时的安全缺省)。 */
export const DEFAULT_TOOL_PERMISSIONS: AgentPresetToolPermissions = { read: true, write: false, exec: false };

export function grantsToTools(perms: AgentPresetToolPermissions | undefined): string[] {
  const p = perms ?? DEFAULT_TOOL_PERMISSIONS;
  return [
    ...(p.read !== false ? RESEARCH_TOOLS : []),
    ...(p.write ? PRODUCE_TOOLS : []),
    ...(p.exec ? EXEC_TOOLS : []),
  ];
}

/** 团队里是否有人被授予了产出能力(决定要不要挂出图 stdio server)。 */
export function anyProduceGrant(list: Array<AgentPresetToolPermissions | undefined>): boolean {
  return list.some((p) => p?.write === true);
}
