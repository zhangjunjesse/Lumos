import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getDefaultProvider, getProvider } from '@/lib/db';
import { getSetting } from '@/lib/db/sessions';
import { generateTextFromProvider, type ChatMessage } from '@/lib/text-generator';
import { validateAnyWorkflowDsl } from '@/lib/workflow/dsl';
import type { AnyWorkflowDSL } from '@/lib/workflow/types';
import { listAgentPresets } from '@/lib/db/agent-presets';
import { WORKFLOW_REFINE_PROMPT } from '@/lib/workflow/default-prompts';

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const requestSchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
  currentDsl: z.record(z.string(), z.unknown()),
  history: z.array(historyItemSchema).max(20).optional(),
});

function buildAgentList(): string {
  const agents = listAgentPresets();
  if (agents.length === 0) return '\n\n## 可用 Agent\n(无可用 Agent，只能修改现有步骤的参数)';
  const lines = agents.map(a => `- id: "${a.id}"  name: "${a.name}"  desc: "${a.description || ''}"`);
  return `\n\n## 可用 Agent\n${lines.join('\n')}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = requestSchema.parse(body);

    const pid = getSetting('workflow_builder_provider_id') || '';
    const provider = pid ? getProvider(pid) : getDefaultProvider();
    if (!provider) {
      return NextResponse.json({ error: '未配置 AI 服务商，请在设置 → AI助手中配置' }, { status: 400 });
    }

    const model = getSetting('workflow_builder_model')
      || (JSON.parse(provider.model_catalog || '[]') as Array<{ value?: string }>)[0]?.value
      || '';
    if (!model) {
      return NextResponse.json({ error: '未找到可用模型' }, { status: 400 });
    }

    const customPrompt = getSetting('workflow_builder_system_prompt') || '';
    const systemPrompt = (customPrompt || WORKFLOW_REFINE_PROMPT) + buildAgentList();

    // Build multi-turn messages
    const messages: ChatMessage[] = [];

    // Add history context
    if (input.history && input.history.length > 0) {
      for (const msg of input.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Final user message: current DSL + instruction
    const userMsg = `## 当前工作流 DSL\n${JSON.stringify(input.currentDsl, null, 2)}\n\n## 修改指令\n${input.instruction}`;
    messages.push({ role: 'user', content: userMsg });

    const raw = await generateTextFromProvider({
      providerId: provider.id,
      model,
      system: systemPrompt,
      messages,
      maxTokens: 4000,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'AI 未返回有效 JSON，请重试', rawResponse: raw }, { status: 422 });
    }

    let dsl: unknown;
    try { dsl = JSON.parse(jsonMatch[0]); } catch {
      return NextResponse.json({ error: 'AI 返回的 JSON 无法解析', rawResponse: raw }, { status: 422 });
    }

    const validation = validateAnyWorkflowDsl(dsl as AnyWorkflowDSL);

    return NextResponse.json({ workflowDsl: dsl, validation, rawResponse: raw });
  } catch (error) {
    const message = error instanceof Error ? error.message : '修改失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
