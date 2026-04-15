/**
 * In-process SDK tools for the workflow chat assistant to manage team
 * departments. Injected into workflow chat sessions via workflow-mcp-server,
 * so the assistant can organize agents into departments during authoring.
 */
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  type TeamDepartment,
} from '@/lib/db/team-departments';

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function summarizeDept(d: TeamDepartment): Record<string, unknown> {
  return {
    id: d.id,
    name: d.name,
    ...(d.description ? { description: d.description } : {}),
    sortOrder: d.sortOrder,
    updatedAt: d.updatedAt,
  };
}

/** Case-insensitive + trim-aware 重名查找(工具层防御,不动底层 DB 行为)。 */
export function findDepartmentByName(name: string): TeamDepartment | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  return listDepartments().find((d) => d.name.trim().toLowerCase() === lower) ?? null;
}

export function createListWorkflowDepartmentsTool() {
  return tool(
    'list_workflow_departments',
    '列出当前租户配置的所有部门(id、name、description、sortOrder)。' +
    '创建或修改带 departmentId 的 agent 前,先用这个工具拿到部门 id。',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const depts = listDepartments();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              total: depts.length,
              departments: depts.map(summarizeDept),
            }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}

export function createCreateWorkflowDepartmentTool() {
  const schema = {
    name: z
      .string()
      .min(1)
      .max(40)
      .describe('部门名称。简洁、有区分度;重名检测忽略大小写与首尾空白。'),
    description: z
      .string()
      .max(500)
      .optional()
      .describe('部门描述(一两句话说明团队职责,便于其他人/agent 理解)。'),
  };
  return tool(
    'create_workflow_department',
    '新建一个部门。会做重名检测,命中时返回 conflict=true + 现有部门摘要,**不落库**。' +
    '成功后返回新部门的 id,可直接用在 create_workflow_agent / update_workflow_agent 的 departmentId 字段。',
    schema,
    async (args): Promise<CallToolResult> => {
      try {
        const existing = findDepartmentByName(args.name);
        if (existing) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                conflict: true,
                message: `已存在同名部门 "${existing.name}" (id=${existing.id})。请直接复用其 id,或换个更有区分度的名字再 create。`,
                existing: summarizeDept(existing),
              }, null, 2),
            }],
            isError: true,
          };
        }
        const created = createDepartment(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, department: summarizeDept(created) }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}

export function createUpdateWorkflowDepartmentTool() {
  const schema = {
    id: z.string().min(1).describe('要修改的部门 id(通过 list_workflow_departments 获取)。'),
    name: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe('新部门名。改名时做重名检测(忽略大小写与首尾空白)。'),
    description: z.string().max(500).optional().describe('新的描述。'),
    sortOrder: z
      .number()
      .int()
      .min(0)
      .max(9999)
      .optional()
      .describe('排序权重,越小越靠前(UI 列表顺序)。'),
  };
  return tool(
    'update_workflow_department',
    '修改现有部门。只传需要改的字段,未传的保持原值。若 name 被修改且与其他部门冲突,返回 conflict=true,不落库。',
    schema,
    async (args): Promise<CallToolResult> => {
      try {
        const { id, ...updates } = args;
        const existing = getDepartment(id);
        if (!existing) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: false, error: `部门 "${id}" 不存在` }, null, 2),
            }],
            isError: true,
          };
        }
        if (
          updates.name
          && updates.name.trim().toLowerCase() !== existing.name.trim().toLowerCase()
        ) {
          const conflict = findDepartmentByName(updates.name);
          if (conflict && conflict.id !== id) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  conflict: true,
                  message: `另一个部门已使用名称 "${conflict.name}" (id=${conflict.id})。请换个名字,或先确认是否应改那个部门。`,
                  existing: summarizeDept(conflict),
                }, null, 2),
              }],
              isError: true,
            };
          }
        }
        const updated = updateDepartment(id, updates);
        if (!updated) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: false, error: `更新 "${id}" 失败` }, null, 2),
            }],
            isError: true,
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, department: summarizeDept(updated) }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
