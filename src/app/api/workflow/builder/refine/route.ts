import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getDefaultProvider, getProvider } from '@/lib/db';
import { getSetting } from '@/lib/db/sessions';
import { generateTextFromProvider, type ChatMessage } from '@/lib/text-generator';
import { listAgentPresets } from '@/lib/db/agent-presets';
import { WORKFLOW_REFINE_PROMPT, WORKFLOW_STABILITY_RULES } from '@/lib/workflow/default-prompts';
import { formatIssuesForLlm } from '@/lib/workflow/validation-llm';
import {
  buildRepairTurn,
  parseWorkflowDslFromText,
  shouldAutoRepair,
  summarizeValidation,
  validateWorkflowBuilderDsl,
} from '@/lib/workflow/builder-llm';

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const issueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
  jsonPath: z.string(),
  message: z.string(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  hint: z.string().optional(),
});

const requestSchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
  currentDsl: z.record(z.string(), z.unknown()),
  history: z.array(historyItemSchema).max(20).optional(),
  /** 可选:传入校验 issues,后端会拼接成修复说明送给 LLM。W3-A "让 AI 修这些" 链路。 */
  issues: z.array(issueSchema).max(100).optional(),
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
    const systemPrompt = (customPrompt || WORKFLOW_REFINE_PROMPT) + '\n\n' + WORKFLOW_STABILITY_RULES + buildAgentList();

    // Build multi-turn messages
    const messages: ChatMessage[] = [];

    // Add history context
    if (input.history && input.history.length > 0) {
      for (const msg of input.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Final user message: current DSL + instruction + (optional) issues
    const parts = [
      `## 当前工作流 DSL\n${JSON.stringify(input.currentDsl, null, 2)}`,
      `## 修改指令\n${input.instruction}`,
    ];
    if (input.issues && input.issues.length > 0) {
      parts.push(formatIssuesForLlm(input.issues));
    }
    messages.push({ role: 'user', content: parts.join('\n\n') });

    const raw = await generateTextFromProvider({
      providerId: provider.id,
      model,
      system: systemPrompt,
      messages,
      maxTokens: 4000,
      requestMetadata: {
        module: 'workflow',
        operation: 'builder-refine',
      },
    });

    const parsedInitial = parseWorkflowDslFromText(raw);
    if (parsedInitial.error) {
      return NextResponse.json({ error: parsedInitial.error, rawResponse: raw }, { status: 422 });
    }

    let dsl = parsedInitial.dsl;
    let rawResponse = raw;
    let report = validateWorkflowBuilderDsl(dsl);

    if (shouldAutoRepair(report)) {
      const repairedRaw = await generateTextFromProvider({
        providerId: provider.id,
        model,
        system: systemPrompt,
        messages: [
          ...messages,
          { role: 'assistant', content: JSON.stringify(dsl, null, 2) },
          ...buildRepairTurn(input.instruction, dsl, formatIssuesForLlm(report.issues)).slice(2),
        ],
        maxTokens: 4000,
        requestMetadata: {
          module: 'workflow',
          operation: 'builder-refine-repair',
        },
      });
      const repairedParsed = parseWorkflowDslFromText(repairedRaw);
      if (!repairedParsed.error) {
        dsl = repairedParsed.dsl;
        rawResponse = repairedRaw;
        report = validateWorkflowBuilderDsl(dsl);
      }
    }

    const validation = summarizeValidation(report);

    return NextResponse.json({ workflowDsl: dsl, validation, rawResponse });
  } catch (error) {
    const message = error instanceof Error ? error.message : '修改失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
