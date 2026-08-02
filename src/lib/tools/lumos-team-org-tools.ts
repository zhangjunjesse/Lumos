// 团队管家的组织管理工具:部门增查 + 成员改。
//
// 「部门」和「团队」是两个正交概念,别混:
//   部门 = 成员的组织归属,一名成员只属于一个部门(可以没有)
//   团队 = 一份 SOP + 一组成员引用,同一名成员可以同时在多个团队里
// 之前聊天侧只有团队工具,AI 只能拿"新建团队"去凑"新建部门",两者并不等价(#56)。

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getAgentPreset, updateAgentPreset } from '@/lib/db/agent-presets';
import { createDepartment, getDepartment, listDepartments } from '@/lib/db/team-departments';
import { errorResult, jsonResult, permissionsSchema } from './lumos-team-tool-kit';

export function createListDepartmentsTool() {
  return tool(
    'list_departments',
    'List existing departments. A department is the org unit a member belongs to (one member, at most one department) — this is NOT the same thing as a team. Call this before assigning anyone to a department.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const departments = listDepartments().map((d) => ({ id: d.id, name: d.name, description: d.description }));
        return jsonResult({ count: departments.length, departments });
      } catch (error) { return errorResult(error); }
    },
  );
}

export function createCreateDepartmentTool() {
  return tool(
    'create_department',
    'Create a department. Only call after the user has approved. If a department with the same name already exists it is reused instead of duplicated.',
    {
      name: z.string().min(1).describe('部门名(如"内容部")。'),
      description: z.string().optional().describe('一句话说明这个部门管什么。'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        // 同名直接复用:AI 反复调用不该在库里堆出一串同名部门
        const existing = listDepartments().find((d) => d.name.trim() === args.name.trim());
        if (existing) {
          return jsonResult({
            success: true,
            department: { id: existing.id, name: existing.name },
            note: '同名部门已存在,已直接复用,未新建。',
          });
        }
        const created = createDepartment({
          name: args.name,
          ...(args.description ? { description: args.description } : {}),
        });
        return jsonResult({
          success: true,
          department: { id: created.id, name: created.name },
          view: '「成员」页按部门分组查看',
        });
      } catch (error) { return errorResult(error); }
    },
  );
}

export function createUpdateMemberTool() {
  return tool(
    'update_member',
    'Update an existing member in place: rename, change responsibility/position/system prompt/permissions, '
    + 'or move them to another department. Use this instead of creating a duplicate member — '
    + 'only the fields you pass are changed, everything else is left alone.',
    {
      member_id: z.string().min(1).describe('成员 id(来自 list_members)。'),
      name: z.string().optional(),
      responsibility: z.string().optional().describe('一句话职能。'),
      position: z.string().optional().describe('头衔。'),
      system_prompt: z.string().optional().describe('完整人设。'),
      permissions: permissionsSchema.optional().describe('只改传了的那几项,没传的保持原样。开 write/exec 需用户同意。'),
      department_id: z.string().nullable().optional()
        .describe('调整所属部门:部门 id(先 list_departments 拿) / null 表示移出部门 / 不传表示不动。'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const existing = getAgentPreset(args.member_id);
        if (!existing) return errorResult(`成员不存在: ${args.member_id}——先用 list_members 拿正确 id`);

        if (args.department_id) {
          const dept = getDepartment(args.department_id);
          if (!dept) {
            return errorResult(
              `部门不存在: ${args.department_id}——先用 list_departments 拿正确 id,或 create_department 新建`,
            );
          }
        }

        // 权限按项合并,不整体替换:只传 {write:true} 不该把原有的 exec 悄悄关掉
        const current = existing.toolPermissions ?? { read: true, write: false, exec: false };
        const permissions = args.permissions
          ? {
              read: args.permissions.read ?? current.read,
              write: args.permissions.write ?? current.write,
              exec: args.permissions.exec ?? current.exec,
            }
          : undefined;

        const updated = updateAgentPreset(args.member_id, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.responsibility !== undefined ? { responsibility: args.responsibility } : {}),
          ...(args.position !== undefined ? { position: args.position } : {}),
          ...(args.system_prompt !== undefined ? { systemPrompt: args.system_prompt } : {}),
          ...(permissions ? { toolPermissions: permissions } : {}),
          ...(args.department_id !== undefined ? { departmentId: args.department_id } : {}),
        });
        if (!updated) return errorResult('更新失败:成员不存在');

        return jsonResult({
          success: true,
          member: {
            id: updated.id,
            name: updated.name,
            department_id: updated.departmentId ?? null,
            permissions: updated.toolPermissions ?? current,
          },
        });
      } catch (error) { return errorResult(error); }
    },
  );
}
