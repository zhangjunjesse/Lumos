import type { AgentNode } from '@/lib/workflow/types-v3';
import type { WorkflowKnowledgeConfigDraft } from '../WorkflowKnowledgePanel';
import { readNodeInput } from './step-editor-shared';

export interface AgentPresetOption {
  id: string;
  name: string;
  description?: string;
}

export interface AgentCodeConfig {
  handler?: string;
  script?: string;
  strategy?: string;
}

export function buildAgentInput(
  node: AgentNode,
  preset: string,
  prompt: string,
  expectedOutput: string,
  codeEnabled: boolean,
  codeScript: string,
  codeStrategy: string,
  knowledge: WorkflowKnowledgeConfigDraft,
): Record<string, unknown> {
  const input = { ...readNodeInput(node) };
  if (preset) input.preset = preset;
  else delete input.preset;
  if (prompt) input.prompt = prompt;
  else delete input.prompt;
  const trimmedExpected = expectedOutput.trim();
  if (trimmedExpected) input.expectedOutput = trimmedExpected;
  else delete input.expectedOutput;
  if (codeEnabled && codeScript.trim()) input.code = { script: codeScript, strategy: codeStrategy };
  else delete input.code;
  if (knowledge.enabled) input.knowledge = buildKnowledgeInput(knowledge);
  else delete input.knowledge;
  return input;
}

function buildKnowledgeInput(knowledge: WorkflowKnowledgeConfigDraft) {
  return {
    enabled: true,
    defaultTagNames: knowledge.defaultTagNames,
    allowAgentTagSelection: knowledge.allowAgentTagSelection,
    ...(typeof knowledge.topK === 'number' ? { topK: knowledge.topK } : {}),
  };
}
