import { z } from 'zod';
import { BUILTIN_CLAUDE_MODEL_IDS } from '@/lib/model-metadata';
import { ProviderResolutionError, resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateObjectFromProvider } from '@/lib/text-generator';
import type { CapabilityCategory, CapabilityDraft, CapabilityKind, CapabilityRiskLevel } from './types';

export interface GenerateCapabilityRequest {
  userPrompt?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  providerId?: string;
  model?: string;
}

export interface GenerateCapabilityResponse {
  draft: CapabilityDraft;
  explanation: string;
}

const capabilityDraftSchema = z.object({
  id: z.string().min(3),
  name: z.string().min(1),
  description: z.string().min(1),
  kind: z.enum(['code', 'prompt']),
  category: z.enum(['document', 'integration', 'browser-helper', 'data']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  inputSchema: z.record(z.string(), z.unknown()).default({}),
  outputSchema: z.record(z.string(), z.unknown()).default({}),
  permissions: z.object({
    workspaceRead: z.boolean().optional(),
    workspaceWrite: z.boolean().optional(),
    shellExec: z.boolean().optional(),
    network: z.boolean().optional(),
  }).default({}),
  summary: z.string().min(1),
  usageExamples: z.array(z.string()).default([]),
  content: z.string().min(1),
});

function normalizeCapabilityId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');

  return normalized || `capability_${Date.now()}`;
}

function normalizeCategory(value: string): CapabilityCategory {
  if (value === 'document' || value === 'integration' || value === 'browser-helper' || value === 'data') {
    return value;
  }
  return 'data';
}

function normalizeRiskLevel(value: string): CapabilityRiskLevel {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return 'medium';
}

function buildConversationTranscript(
  userPrompt?: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const items = [...(conversationHistory || [])];
  if (userPrompt && userPrompt.trim().length > 0) {
    items.push({ role: 'user' as const, content: userPrompt });
  }
  return items
    .filter((item) => item.content.trim().length > 0)
    .map((item) => `${item.role === 'user' ? '用户' : 'AI'}: ${item.content.trim()}`)
    .join('\n\n');
}

function buildSystemPrompt(): string {
  return [
    '你是 Lumos 的能力生成器。你的任务不是继续聊天，而是把已经澄清过的对话整理成一个可发布的能力候选。',
    '能力只允许两类：',
    '1. code: 确定性代码节点，例如文件转换、提取、清洗、处理。',
    '2. prompt: 给 agent 调用的 Prompt 节点，例如总结、分类、分析、改写。',
    '',
    '请严格输出结构化对象，不要输出额外解释。',
    '',
    '约束：',
    '- id 使用英文、小写、点或下划线，例如 doc.export_markdown_to_word',
    '- category 只能是 document / integration / browser-helper / data',
    '- riskLevel 只能是 low / medium / high',
    '- inputSchema 和 outputSchema 用普通 JSON 对象描述字段',
    '- summary 用 1 到 3 句说明这个能力做什么，供 UI 预览',
    '- usageExamples 提供 1 到 3 条简短示例',
    '',
    '如果 kind=code：',
    '- content 必须是完整 TypeScript 模块',
    '- 模块必须导出 export async function execute(input)',
    "- execute 返回 { success: boolean, output: any, error?: string }",
    '- 尽量使用 Node 内置能力，不依赖额外 npm 包',
    '- 如果涉及文件产物，output 中返回结构化字段，不要只返回一句话',
    '',
    '如果 kind=prompt：',
    '- content 必须是纯 markdown prompt 内容',
    '- 不要使用代码块包裹',
    '- prompt 要明确角色、输入要求、输出要求、失败处理',
    '',
    '风险判断：',
    '- 只读且不触网通常 low',
    '- 写工作区或产出文件通常 medium',
    '- 命令执行、外网调用、外部系统写入通常 high',
  ].join('\n');
}

function buildPrompt(transcript: string): string {
  return [
    '请根据下面已经澄清过的对话，生成一个能力候选对象。',
    '如果信息仍不足以生成稳定能力，请尽量基于对话做最保守、最明确的收敛，不要反问。',
    '',
    '对话记录：',
    transcript,
  ].join('\n\n');
}

function createDraft(
  generated: z.infer<typeof capabilityDraftSchema>,
  now: string
): CapabilityDraft {
  const kind = generated.kind as CapabilityKind;

  return {
    id: normalizeCapabilityId(generated.id),
    name: generated.name.trim(),
    description: generated.description.trim(),
    kind,
    category: normalizeCategory(generated.category),
    riskLevel: normalizeRiskLevel(generated.riskLevel),
    inputSchema: generated.inputSchema,
    outputSchema: generated.outputSchema,
    permissions: generated.permissions,
    implementation: kind === 'code'
      ? {
          kind: 'inline-code',
          source: generated.content.trim(),
          generatedSummary: generated.summary.trim(),
          usageExamples: generated.usageExamples,
        }
      : {
          kind: 'inline-prompt',
          source: generated.content.trim(),
          generatedSummary: generated.summary.trim(),
          usageExamples: generated.usageExamples,
        },
    validationErrors: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function generateCapabilityDraft(
  request: GenerateCapabilityRequest
): Promise<GenerateCapabilityResponse> {
  const transcript = buildConversationTranscript(request.userPrompt, request.conversationHistory);
  let resolvedProviderId = '';
  try {
    resolvedProviderId = resolveProviderForCapability({
      moduleKey: 'knowledge',
      capability: 'text-gen',
      preferredProviderId: request.providerId?.trim() || undefined,
    })?.id || '';
  } catch (error) {
    if (error instanceof ProviderResolutionError) {
      throw new Error(error.message);
    }
    throw error;
  }

  const generated = await generateObjectFromProvider({
    providerId: resolvedProviderId,
    model: request.model || BUILTIN_CLAUDE_MODEL_IDS.sonnet,
    system: buildSystemPrompt(),
    prompt: buildPrompt(transcript),
    schema: capabilityDraftSchema,
  });

  const now = new Date().toISOString();
  const draft = createDraft(generated, now);
  const implementation = draft.implementation;
  const explanation = implementation?.kind === 'inline-code' || implementation?.kind === 'inline-prompt'
    ? implementation.generatedSummary || generated.summary.trim()
    : generated.summary.trim();

  return {
    draft,
    explanation,
  };
}
