// 团队管家(进程内 MCP):让聊天 AI 对话式创建/列出成员与团队。
// 纪律靠 skill + buildHint(先草稿后确认、权限默认只读);团队/成员可删可改,低风险。
// 工具本体在此,方法论在 public/skills/team-manager.md。

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createAgentPreset, getAgentPreset, listAgentPresets } from '@/lib/db/agent-presets';
import { createTeam, getTeam, listTeams, updateTeam } from '@/lib/team/store';

export const LUMOS_TEAM_MCP_SERVER_NAME = 'lumos-team';

export const LUMOS_TEAM_MCP_SYSTEM_HINT = `
## Lumos 团队管家能力

你能帮用户对话式地创建"AI 成员"和"AI 团队"。成员 = 一个有职能和人设的 AI 角色;团队 = 一份 SOP(队长工作手册) + 一组成员,聊天/工作流里可整队协作干活。可用工具:
- \`mcp__lumos-team__list_members()\` / \`list_teams()\`:先看现有的,能复用就复用,不要重复造。
- \`mcp__lumos-team__create_member({name, responsibility, system_prompt, permissions?, position?})\`:建一名成员。
- \`mcp__lumos-team__create_team({name, description?, sop, member_ids})\`:建一个团队,member_ids 引用已建成员。
- \`mcp__lumos-team__update_team({team_id, ...})\`:改团队(改 SOP/加减成员)。

铁律:
- **先草稿后落库**:先用自然语言把方案讲给用户——要建哪几个成员(各自职能一句话)、团队 SOP 的分工与工序大纲——用户明确认可后,才调 create 工具真正写库。不要一上来就建。
- **权限默认只读**:permissions 缺省只给 read。要给成员开 write(写文件/出图,可能花钱)或 exec(执行命令,可运行任意命令)必须先跟用户说清风险、得到同意,并在方案里标出来。
- 成员 system_prompt 要写成完整人设(身份/专长/工作方式/输出风格),responsibility 是一句话职能(队长据此派单)。
- SOP 是写给队长看的:分工、工序顺序、质量标准、失败应对;别只写一句话。
- 建完告诉用户:去侧边栏「团队」/「成员」页可查看、修改、删除,或在聊天输入框选团队开聊、在工作流里加团队步骤。
`;

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function errorResult(error: unknown): CallToolResult {
  const msg = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: msg }, null, 2) }], isError: true };
}

const permissionsSchema = z.object({
  read: z.boolean().optional().describe('读取与调研(读文件/网络搜索)。缺省 true。'),
  write: z.boolean().optional().describe('产出(写文件/出图,可能花钱)。缺省 false,需用户同意。'),
  exec: z.boolean().optional().describe('执行命令(可运行任意命令,高风险)。缺省 false,需用户明确同意。'),
}).describe('成员在团队协作中的工具权限;缺省只给 read。');

function createListMembersTool() {
  return tool('list_members', 'List existing AI members (agent presets) so you can reuse instead of duplicating.', {}, async (): Promise<CallToolResult> => {
    try {
      const members = listAgentPresets().map((m) => ({
        id: m.id, name: m.name,
        responsibility: m.responsibility || m.description || '',
        position: m.position || '',
        permissions: m.toolPermissions ?? { read: true, write: false, exec: false },
      }));
      return jsonResult({ count: members.length, members });
    } catch (error) { return errorResult(error); }
  });
}

function createListTeamsTool() {
  return tool('list_teams', 'List existing teams with their members.', {}, async (): Promise<CallToolResult> => {
    try {
      const teams = listTeams().map((t) => ({
        id: t.id, name: t.name, description: t.description,
        member_count: t.memberRefs.length,
        member_ids: t.memberRefs.map((r) => r.presetId),
      }));
      return jsonResult({ count: teams.length, teams });
    } catch (error) { return errorResult(error); }
  });
}

function createCreateMemberTool() {
  return tool(
    'create_member',
    'Create an AI member (agent preset). Only call after the user has approved the plan you presented. permissions default to read-only.',
    {
      name: z.string().min(1).describe('成员名(简短,如"选题调研员")。'),
      responsibility: z.string().min(1).describe('一句话职能,队长据此派单。'),
      system_prompt: z.string().min(1).describe('完整人设:身份/专长/工作方式/输出风格。'),
      permissions: permissionsSchema.optional(),
      position: z.string().optional().describe('可选头衔,如"资深研究员"。'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const created = createAgentPreset({
          name: args.name,
          systemPrompt: args.system_prompt,
          responsibility: args.responsibility,
          ...(args.position ? { position: args.position } : {}),
          toolPermissions: {
            read: args.permissions?.read !== false,
            write: args.permissions?.write === true,
            exec: args.permissions?.exec === true,
          },
        });
        return jsonResult({ success: true, member: { id: created.id, name: created.name }, view: '「成员」页可查看/修改' });
      } catch (error) { return errorResult(error); }
    },
  );
}

function createCreateTeamTool() {
  return tool(
    'create_team',
    'Create a team (SOP + member references). Only call after the user has approved the plan. member_ids must be ids from create_member/list_members.',
    {
      name: z.string().min(1).describe('团队名。'),
      description: z.string().optional().describe('一句话描述团队擅长什么。'),
      sop: z.string().min(1).describe('队长工作手册:分工/工序/质量标准/失败应对。'),
      member_ids: z.array(z.string().min(1)).min(1).describe('成员 id 数组(来自 list_members / create_member)。'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const missing = args.member_ids.filter((id) => !getAgentPreset(id));
        if (missing.length > 0) return errorResult(`成员不存在: ${missing.join(', ')}——先用 create_member 建好再引用`);
        const team = createTeam({
          name: args.name,
          ...(args.description ? { description: args.description } : {}),
          sop: args.sop,
          memberRefs: args.member_ids.map((presetId) => ({ presetId, enabled: true })),
        });
        return jsonResult({ success: true, team: { id: team.id, name: team.name, member_count: team.memberRefs.length }, view: '「团队」页可查看/修改,聊天输入框可选它开聊' });
      } catch (error) { return errorResult(error); }
    },
  );
}

function createUpdateTeamTool() {
  return tool(
    'update_team',
    'Update a team: change name/description/sop, or add/remove members. Only call after user approval.',
    {
      team_id: z.string().min(1),
      name: z.string().optional(),
      description: z.string().optional(),
      sop: z.string().optional(),
      add_member_ids: z.array(z.string().min(1)).optional().describe('要加入的成员 id。'),
      remove_member_ids: z.array(z.string().min(1)).optional().describe('要移除的成员 id。'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const team = getTeam(args.team_id);
        if (!team) return errorResult('团队不存在');
        const add = args.add_member_ids ?? [];
        const missing = add.filter((id) => !getAgentPreset(id));
        if (missing.length > 0) return errorResult(`成员不存在: ${missing.join(', ')}`);
        const remove = new Set(args.remove_member_ids ?? []);
        const refs = team.memberRefs.filter((r) => !remove.has(r.presetId));
        for (const id of add) if (!refs.some((r) => r.presetId === id)) refs.push({ presetId: id, enabled: true });
        const updated = updateTeam(args.team_id, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.sop !== undefined ? { sop: args.sop } : {}),
          ...((args.add_member_ids || args.remove_member_ids) ? { memberRefs: refs } : {}),
        });
        return jsonResult({ success: true, team: { id: updated.id, name: updated.name, member_count: updated.memberRefs.length } });
      } catch (error) { return errorResult(error); }
    },
  );
}

export function createLumosTeamMcpServer() {
  return createSdkMcpServer({
    name: LUMOS_TEAM_MCP_SERVER_NAME,
    tools: [
      createListMembersTool(),
      createListTeamsTool(),
      createCreateMemberTool(),
      createCreateTeamTool(),
      createUpdateTeamTool(),
    ],
  });
}
