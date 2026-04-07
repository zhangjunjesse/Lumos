/**
 * In-process SDK tools for the workflow chat assistant to discover agent presets.
 *
 * Only injected into workflow chat sessions (via workflow-mcp-server). Gives the
 * assistant a live view of configured agents so it can pick the right `preset` id
 * when editing a workflow DSL.
 */
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { listAgentPresets, getAgentPreset } from '@/lib/db/agent-presets';
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
