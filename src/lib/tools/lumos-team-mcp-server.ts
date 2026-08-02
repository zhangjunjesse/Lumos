// 团队管家(进程内 MCP):让聊天 AI 对话式创建/列出成员与团队。
// 纪律靠 skill + buildHint(先草稿后确认、权限默认只读);团队/成员可删可改,低风险。
// 工具本体在此,方法论在 public/skills/team-manager.md。

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createAgentPreset, getAgentPreset, listAgentPresets } from '@/lib/db/agent-presets';
import { getDepartment, listDepartments } from '@/lib/db/team-departments';
import { createTeam, getTeam, listTeams, updateTeam } from '@/lib/team/store';
import { errorResult, jsonResult, permissionsSchema } from './lumos-team-tool-kit';
import {
  createCreateDepartmentTool,
  createListDepartmentsTool,
  createUpdateMemberTool,
} from './lumos-team-org-tools';

export const LUMOS_TEAM_MCP_SERVER_NAME = 'lumos-team';

export const LUMOS_TEAM_MCP_SYSTEM_HINT = `
## Lumos 团队管家能力

你能帮用户对话式地管理"AI 成员""部门"和"AI 团队"。这三个是不同的东西,别混:
- **成员** = 一个有职能和人设的 AI 角色。
- **部门** = 成员的组织归属。一名成员最多属于一个部门,也可以不属于任何部门。
- **团队** = 一份 SOP(队长工作手册) + 一组成员引用,聊天/工作流里可整队协作干活。同一名成员可以同时出现在多个团队里。

所以「把这几个人归到一个部门」和「用这几个人组一个团队」是两件事,**不要拿"新建团队"去凑"新建部门"**。

可用工具:
- \`mcp__lumos-team__list_members()\` / \`list_teams()\` / \`list_departments()\`:先看现有的,能复用就复用,不要重复造。
- \`mcp__lumos-team__create_member({name, responsibility, system_prompt, permissions?, position?, department_id?})\`:建一名成员。
- \`mcp__lumos-team__update_member({member_id, name?, responsibility?, position?, system_prompt?, permissions?, department_id?})\`:改一名已有成员,包括调整所属部门(department_id 传 null = 移出部门)。只改你传的字段,其余保持原样。
- \`mcp__lumos-team__create_department({name, description?})\`:建一个部门(同名会直接复用,不会建重)。
- \`mcp__lumos-team__create_team({name, description?, sop, member_ids})\`:建一个团队,member_ids 引用已建成员。
- \`mcp__lumos-team__update_team({team_id, ...})\`:改团队(改 SOP/加减成员)。

铁律:
- **先草稿后落库**:先用自然语言把方案讲给用户——要建哪几个成员(各自职能一句话)、团队 SOP 的分工与工序大纲——用户明确认可后,才调 create 工具真正写库。不要一上来就建。
- **改人用 update_member,不要新建同名成员**:调整某人的部门/权限/人设,直接 update_member 改。新建一个同名的再把旧的换出去,会在库里留下一堆孤立记录。
- **权限默认只读**:permissions 缺省只给 read。要给成员开 write(写文件/出图,可能花钱)或 exec(执行命令,可运行任意命令)必须先跟用户说清风险、得到同意,并在方案里标出来。update_member 改权限同样要先征得同意。
- 成员 system_prompt 要写成完整人设(身份/专长/工作方式/输出风格),responsibility 是一句话职能(队长据此派单)。
- SOP 是写给队长看的:分工、工序顺序、质量标准、失败应对;别只写一句话。
- 建完告诉用户:去侧边栏「团队」/「成员」页可查看、修改、删除,或在聊天输入框选团队开聊、在工作流里加团队步骤。
`;

function createListMembersTool() {
  return tool('list_members', 'List existing AI members (agent presets) with the department each belongs to, so you can reuse instead of duplicating.', {}, async (): Promise<CallToolResult> => {
    try {
      // 带上部门名,只给 id 的话 AI 没法跟用户说人话
      const deptNames = new Map(listDepartments().map((d) => [d.id, d.name]));
      const members = listAgentPresets().map((m) => ({
        id: m.id, name: m.name,
        responsibility: m.responsibility || m.description || '',
        position: m.position || '',
        department: m.departmentId
          ? { id: m.departmentId, name: deptNames.get(m.departmentId) ?? '(部门已删除)' }
          : null,
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
      department_id: z.string().optional()
        .describe('可选,所属部门 id(先 list_departments 拿,没有合适的可 create_department)。不传则不归属任何部门。'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        if (args.department_id && !getDepartment(args.department_id)) {
          return errorResult(
            `部门不存在: ${args.department_id}——先用 list_departments 拿正确 id,或 create_department 新建`,
          );
        }
        const created = createAgentPreset({
          name: args.name,
          systemPrompt: args.system_prompt,
          responsibility: args.responsibility,
          ...(args.position ? { position: args.position } : {}),
          ...(args.department_id ? { departmentId: args.department_id } : {}),
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
      createListDepartmentsTool(),
      createCreateMemberTool(),
      createUpdateMemberTool(),
      createCreateTeamTool(),
      createUpdateTeamTool(),
      createCreateDepartmentTool(),
    ],
  });
}
