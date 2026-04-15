/**
 * In-process SDK tools for the workflow chat assistant to discover agent presets.
 *
 * Only injected into workflow chat sessions (via workflow-mcp-server). Gives the
 * assistant a live view of configured agents so it can pick the right `preset` id
 * when editing a workflow DSL.
 */
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import {
  listAgentPresets,
  getAgentPreset,
  getAgentPresetByName,
  createAgentPreset,
  updateAgentPreset,
} from '@/lib/db/agent-presets';
import { getDepartment } from '@/lib/db/team-departments';
import type { AgentPresetDirectoryItem } from '@/types';

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function summarizeAgent(a: AgentPresetDirectoryItem): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    roleKind: a.roleKind,
    ...(a.responsibility ? { responsibility: a.responsibility } : {}),
    ...(a.description ? { description: a.description } : {}),
    ...(a.specialties ? { specialties: a.specialties } : {}),
    ...(a.preferredModel ? { preferredModel: a.preferredModel } : {}),
    ...(a.mcpServers?.length ? { mcpServers: a.mcpServers } : {}),
    updatedAt: a.updatedAt,
  };
}

export function createListWorkflowAgentsTool() {
  const schema = {
    query: z
      .string()
      .optional()
      .describe('可选:按名称、职责、描述、专长、角色类型模糊过滤(大小写不敏感)。不传则返回全部。'),
  };

  return tool(
    'list_workflow_agents',
    '列出当前租户配置的所有 Agent preset(摘要信息)。' +
    '返回 id、name、roleKind、responsibility、description、specialties、preferredModel、mcpServers。' +
    '编辑工作流时用这个工具确认可用的 agent id 与能力,避免写错 preset。',
    schema,
    async (args): Promise<CallToolResult> => {
      try {
        const all = listAgentPresets();
        const q = args.query?.trim().toLowerCase();
        const filtered = q
          ? all.filter((a) => {
              const hay = [
                a.name,
                a.roleKind,
                a.responsibility,
                a.description,
                a.specialties,
                a.interests,
                a.position,
              ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
              return hay.includes(q);
            })
          : all;

        const body = {
          total: all.length,
          matched: filtered.length,
          ...(q ? { query: q } : {}),
          agents: filtered.map(summarizeAgent),
        };

        return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
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

const ROLE_KIND_VALUES = ['orchestrator', 'lead', 'worker'] as const;

const toolPermissionsSchema = z
  .object({
    read: z.boolean(),
    write: z.boolean(),
    exec: z.boolean(),
  })
  .describe('工具权限三元组(read/write/exec)。未设置时 agent 采用默认能力。');

const mutableAgentFields = {
  roleKind: z
    .enum(ROLE_KIND_VALUES)
    .optional()
    .describe('角色类型:orchestrator(编排者) / lead(负责人) / worker(执行者)。默认 worker。'),
  responsibility: z.string().max(500).optional().describe('一句话职责概括,展示在 UI 和其他 agent 的上下文里。'),
  description: z.string().max(2000).optional().describe('详细描述。'),
  collaborationStyle: z.string().max(2000).optional().describe('与其他 agent 协作的风格约定。'),
  outputContract: z.string().max(4000).optional().describe('输出契约:agent 应输出什么格式/字段。'),
  preferredModel: z.string().max(200).optional().describe('首选模型 id,如 claude-sonnet-4-5。不传用全局默认。'),
  providerId: z.string().max(200).optional().describe('Provider id。不传用全局默认,通常不需要传。'),
  mcpServers: z
    .array(z.string().min(1).max(200))
    .max(20)
    .optional()
    .describe('挂载的 MCP server name 数组(最多 20 个)。'),
  toolPermissions: toolPermissionsSchema.optional(),
  position: z.string().max(200).optional().describe('员工身份:职位。'),
  interests: z.string().max(500).optional().describe('员工身份:兴趣。'),
  specialties: z.string().max(500).optional().describe('员工身份:专长。'),
  departmentId: z
    .string()
    .nullable()
    .optional()
    .describe(
      '所属部门 id(先 list_workflow_departments 拿)。传 null 表示从部门移除/无部门;不传则保持现值(update)或默认无部门(create)。',
    ),
} as const;

/** 校验 departmentId 存在性。undefined 或 null 视为不校验(前者=不变,后者=清空)。 */
function validateDepartmentId(departmentId: string | null | undefined): CallToolResult | null {
  if (!departmentId) return null;
  const dept = getDepartment(departmentId);
  if (dept) return null;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: false,
        error: `部门 "${departmentId}" 不存在。请先 list_workflow_departments 拿正确 id,或 create_workflow_department 新建。`,
      }, null, 2),
    }],
    isError: true,
  };
}

/**
 * Case-insensitive + trim-aware 重名查找,在工具层做防御,不改底层 DB 行为。
 * 先精确查(走索引),未命中时做一次全表扫描做宽松匹配。租户 agent 通常 < 100,
 * O(N) 可接受。
 */
function findExistingByName(name: string): AgentPresetDirectoryItem | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const exact = getAgentPresetByName(trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  return listAgentPresets().find((a) => a.name.trim().toLowerCase() === lower) ?? null;
}

export function createCreateWorkflowAgentTool() {
  const schema = {
    name: z.string().min(1).max(80).describe('Agent 名称。简洁,能体现职责;会用于 UI 展示和重名检测(不区分大小写与首尾空白)。'),
    systemPrompt: z
      .string()
      .min(1)
      .max(32000)
      .describe('完整的 system prompt:告诉 agent 它是谁、做什么、边界约束、输出要求。'),
    ...mutableAgentFields,
  };

  return tool(
    'create_workflow_agent',
    '在当前租户创建一个 Agent preset。' +
    '调用前会按 name 检查重名,若已存在同名 agent,**不会**创建,而是返回 conflict=true 以及现有 agent 的摘要——' +
    '由你判断是改用 update_workflow_agent 修改现有 agent,还是换个名字重新 create。' +
    '成功后返回新 agent 的完整信息,其 id 可直接写进工作流 DSL 步骤的 preset 字段。',
    schema,
    async (args): Promise<CallToolResult> => {
      try {
        const deptError = validateDepartmentId(args.departmentId);
        if (deptError) return deptError;
        const existing = findExistingByName(args.name);
        if (existing) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                conflict: true,
                message: `已存在同名 agent "${existing.name}" (id=${existing.id})。重名检测不区分大小写与首尾空白。请考虑:若是同一用途用 update_workflow_agent 修改现有的;否则换个更能区分的名字再 create。`,
                existing: summarizeAgent(existing),
              }, null, 2),
            }],
            isError: true,
          };
        }
        const created = createAgentPreset(args);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, agent: created }, null, 2),
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

export function createUpdateWorkflowAgentTool() {
  const schema = {
    id: z.string().min(1).describe('要修改的 Agent preset id(通过 list_workflow_agents 获取)。'),
    name: z.string().min(1).max(80).optional().describe('新名称。改名时会检查是否与其他 agent 冲突(不区分大小写与首尾空白)。'),
    systemPrompt: z.string().min(1).max(32000).optional().describe('新的 system prompt(整体替换,不是追加)。'),
    ...mutableAgentFields,
  };

  return tool(
    'update_workflow_agent',
    '修改现有 Agent preset。只传需要改的字段,未传的保持原值。' +
    '若 name 被修改且与其他 agent 冲突,返回 conflict=true,不落库。' +
    '成功后返回更新后的完整信息。',
    schema,
    async (args): Promise<CallToolResult> => {
      try {
        const { id, ...updates } = args;
        const existing = getAgentPreset(id);
        if (!existing) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: false, error: `Agent preset "${id}" 不存在` }, null, 2),
            }],
            isError: true,
          };
        }
        if (updates.departmentId !== undefined) {
          const deptError = validateDepartmentId(updates.departmentId);
          if (deptError) return deptError;
        }
        if (updates.name && updates.name.trim().toLowerCase() !== existing.name.trim().toLowerCase()) {
          const conflict = findExistingByName(updates.name);
          if (conflict && conflict.id !== id) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  conflict: true,
                  message: `另一个 agent 已使用名称 "${updates.name}" (id=${conflict.id})。请换个名字,或先确认是否应改那个 agent。`,
                  existing: summarizeAgent(conflict),
                }, null, 2),
              }],
              isError: true,
            };
          }
        }
        const updated = updateAgentPreset(id, updates);
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
            text: JSON.stringify({ success: true, agent: updated }, null, 2),
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

export function createGetWorkflowAgentTool() {
  const schema = {
    id: z.string().min(1).describe('Agent preset id(从 list_workflow_agents 获取)。'),
  };

  return tool(
    'get_workflow_agent',
    '获取单个 Agent preset 的完整详情,包含 systemPrompt、collaborationStyle、outputContract、toolPermissions 等。' +
    '当需要深入了解某个 agent 的行为或判断是否适合某个步骤时使用。',
    schema,
    async (args): Promise<CallToolResult> => {
      try {
        const agent = getAgentPreset(args.id);
        if (!agent) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: false, error: `Agent preset "${args.id}" 不存在` }, null, 2),
            }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }] };
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
