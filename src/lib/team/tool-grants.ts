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

/**
 * 缺省授权:全开。
 *
 * 团队在本机跑用户自己的活,默认就该能干完整工序。早期缺省是只开读研,结果 SOP 干到
 * 最后一步「跑 python 写台账」必然失败(#46),而且成员看不到 Bash 就把「没授权」
 * 编成「环境不支持」,用户根本无法定位。想收紧个别成员,去「成员」设置关对应开关。
 */
export const DEFAULT_TOOL_PERMISSIONS: AgentPresetToolPermissions = { read: true, write: true, exec: true };

/** 按权限档位算出该成员要禁用的工具(继承全部之上做减法)。 */
export function grantsToDisallowedTools(perms: AgentPresetToolPermissions | undefined): string[] {
  const p = perms ?? DEFAULT_TOOL_PERMISSIONS;
  const disallowed: string[] = [];
  if (!p.exec) disallowed.push(...EXEC_TOOLS);
  if (!p.write) disallowed.push(...PRODUCE_TOOLS);
  return disallowed;
}

/**
 * 授权告知:被收紧的成员必须知道自己缺什么,否则会把「没授权」说成「环境不支持」,
 * 再给个「手动命令占位」糊弄过去 —— #46 的用户就是这么被带偏一整轮的。
 * 全开时返回空串,不占 token。
 */
export function buildToolGrantNotice(perms: AgentPresetToolPermissions | undefined): string {
  const p = perms ?? DEFAULT_TOOL_PERMISSIONS;
  const missing: string[] = [];
  if (!p.exec) missing.push('执行命令(Bash):不能跑脚本、命令行、python');
  if (!p.write) missing.push('产出(Write/Edit/生成图片):不能写文件、不能出图');
  if (missing.length === 0) return '';
  return [
    '',
    '===== 你的授权范围(管理员配置,不可绕过) =====',
    '你被关闭了以下能力:',
    ...missing.map((m) => `- ${m}`),
    '任务需要这些能力时,如实说明「我没有 X 授权,请到「成员」设置里打开对应开关」,',
    '并讲清哪一步因此没做完。',
    '严禁说成「环境不支持 / 沙箱没有这个能力」——这是授权问题,不是环境问题。',
    '也严禁用占位内容、手动命令清单冒充已完成的产出。',
  ].join('\n');
}
