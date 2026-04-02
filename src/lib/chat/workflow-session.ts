import type { ChatSession } from '@/types';
import { getSetting } from '@/lib/db/sessions';
import { listAgentPresets } from '@/lib/db/agent-presets';
import { WORKFLOW_REFINE_PROMPT } from '@/lib/workflow/default-prompts';

export const WORKFLOW_CHAT_TITLE = '工作流 AI 助手';
export const WORKFLOW_CHAT_MARKER = '__LUMOS_WORKFLOW_CHAT__';

export function buildWorkflowChatSystemPrompt(dslJson?: string): string {
  const customPrompt = getSetting('workflow_builder_system_prompt') || '';
  const basePrompt = customPrompt || WORKFLOW_REFINE_PROMPT;

  const agents = listAgentPresets();
  const agentBlock = agents.length === 0
    ? '\n\n## 可用 Agent\n(无)'
    : '\n\n## 可用 Agent\n' + agents.map(a => `- id: "${a.id}"  name: "${a.name}"  desc: "${a.description || ''}"`).join('\n');

  const dslBlock = dslJson
    ? `\n\n## 当前工作流 DSL\n${dslJson}`
    : '';

  return [
    WORKFLOW_CHAT_MARKER,
    basePrompt,
    agentBlock,
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
  session?: Pick<ChatSession, 'system_prompt'> | null,
): boolean {
  return Boolean(session?.system_prompt?.includes(WORKFLOW_CHAT_MARKER));
}
