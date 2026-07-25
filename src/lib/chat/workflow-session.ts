import type { AgentPresetDirectoryItem, ChatSession } from '@/types';
import { getSetting } from '@/lib/db/sessions';
import { listAgentPresets } from '@/lib/db/agent-presets';
import { quotePromptField } from '@/lib/llm/prompt-field';
import { buildTeamListBlock } from '@/lib/team/prompt-block';
import { WORKFLOW_REFINE_PROMPT, WORKFLOW_STABILITY_RULES } from '@/lib/workflow/default-prompts';
import { getSessionKind, SESSION_TITLES } from './session-kind';
import { WORKFLOW_CAPABILITIES_HINT } from './workflow-session-hint';

export const WORKFLOW_CHAT_TITLE = SESSION_TITLES.workflow;

const STATIC_AGENT_LIST_CAP = 30;

function formatAgentLine(a: AgentPresetDirectoryItem): string {
  const parts: string[] = [
    `- id: ${quotePromptField(a.id)}`,
    `name: ${quotePromptField(a.name)}`,
    `role: ${a.roleKind}`,
  ];
  if (a.responsibility) parts.push(`responsibility: ${quotePromptField(a.responsibility)}`);
  else if (a.description) parts.push(`desc: ${quotePromptField(a.description)}`);
  if (a.specialties) parts.push(`specialties: ${quotePromptField(a.specialties)}`);
  if (a.preferredModel) parts.push(`model: ${quotePromptField(a.preferredModel)}`);
  if (a.mcpServers?.length) parts.push(`mcp: [${a.mcpServers.join(', ')}]`);
  return parts.join('  ');
}

export function buildWorkflowChatSystemPrompt(dslJson?: string): string {
  const customPrompt = getSetting('workflow_builder_system_prompt') || '';
  const basePrompt = customPrompt || WORKFLOW_REFINE_PROMPT;

  const agents = listAgentPresets();
  const shownAgents = agents.slice(0, STATIC_AGENT_LIST_CAP);
  const overflowCount = agents.length - shownAgents.length;
  const agentBlock = agents.length === 0
    ? '\n\n## 可用 Agent\n(无)\n注意:目前租户没有配置任何 Agent preset,用户需要先去"工作流 → Agent 管理"创建。'
    : [
        '\n\n## 可用 Agent',
        `当前共 ${agents.length} 个 Agent preset,每行包含关键字段(需要完整 systemPrompt 等详情请调用 get_workflow_agent(id)):`,
        ...shownAgents.map(formatAgentLine),
        ...(overflowCount > 0
          ? [`...还有 ${overflowCount} 个未显示,请用 list_workflow_agents 查询完整列表。`]
          : []),
        '',
        '**重要**:这个列表是会话创建时的快照。如果用户在对话中新增/修改/删除了 Agent,请调用 `list_workflow_agents` 工具刷新最新状态,不要依赖上面的静态列表。',
      ].join('\n');

  const dslBlock = dslJson
    ? `\n\n## 当前工作流 DSL\n${dslJson}`
    : '';

  return [
    basePrompt,
    WORKFLOW_STABILITY_RULES,
    WORKFLOW_CAPABILITIES_HINT,
    agentBlock,
    // 团队名单:提示词里「AVAILABLE TEAMS 为空时不要使用 team 节点」是硬规则,漏拼
    // 等于让助手以为没有团队,把 team 节点整个关掉(用户症状:助手看不到团队)。
    `\n${buildTeamListBlock()}`,
    dslBlock,
  ].join('\n');
}

/** Resolve workflow builder provider ID (empty string → use session default). */
export function getWorkflowProviderId(): string {
  return getSetting('workflow_builder_provider_id') || '';
}

/** Resolve workflow builder model (empty string → use session default). */
export function getWorkflowModel(): string {
  return getSetting('workflow_builder_model') || '';
}

export function isWorkflowChatSession(
  session?: Pick<ChatSession, 'kind'> | null,
): boolean {
  return getSessionKind(session) === 'workflow';
}

const WORKFLOW_CHAT_BINDING_KEY_PREFIX = 'workflow_chat_session:';

/**
 * Settings key that binds a workflow id to its persisted chat session id.
 * Stored in the SQLite `settings` table so the binding survives Electron
 * port-fallback (which would otherwise reset per-origin localStorage).
 */
export function buildWorkflowChatSessionBindingKey(workflowId: string): string {
  return `${WORKFLOW_CHAT_BINDING_KEY_PREFIX}${workflowId}`;
}
