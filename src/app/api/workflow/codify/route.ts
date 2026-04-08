import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getDefaultProvider, getProvider } from '@/lib/db';
import { getSetting } from '@/lib/db/sessions';
import { generateTextFromProvider } from '@/lib/text-generator';
import { WORKFLOW_CODIFY_PROMPT } from '@/lib/workflow/default-prompts';

const requestSchema = z.object({
  /** 步骤的 prompt（描述意图） */
  prompt: z.string().min(1),
  /** 执行追踪（markdown 格式的 tool calls） */
  trace: z.string().min(1),
});

/**
 * POST /api/workflow/codify
 * 调用 Codify Agent，将执行追踪转换为内联脚本
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = requestSchema.parse(body);

    const providerId = getSetting('workflow_codify_provider_id') || '';
    const model = getSetting('workflow_codify_model') || '';
    const customPrompt = getSetting('workflow_codify_system_prompt') || '';
    const systemPrompt = customPrompt || WORKFLOW_CODIFY_PROMPT;

    const provider = providerId ? getProvider(providerId) : getDefaultProvider();
    if (!provider) {
      return NextResponse.json(
        { error: '未配置 Codify Agent 服务商，请先在设置 → AI助手中配置' },
        { status: 400 },
      );
    }

    const effectiveModel = model || (() => {
      const catalog = JSON.parse(provider.model_catalog || '[]') as Array<{ value?: string }>;
      return catalog[0]?.value || '';
    })();

    if (!effectiveModel) {
      return NextResponse.json(
        { error: '未配置 Codify Agent 模型，请在设置 → AI助手中选择模型' },
        { status: 400 },
      );
    }

    const userMessage = [
      '## 步骤 Prompt',
      input.prompt,
      '',
      '## 执行追踪',
      input.trace,
      '',
      '请将上述执行追踪转换为等效的 JavaScript 内联脚本。',
      '脚本以 async function body 形式编写，可使用 ctx 变量（含 params, upstreamOutputs, signal, browser）。',
      '浏览器操作必须使用 ctx.browser（共享登录态），不要用 fetch 或 curl。',
      '必须 return { success: true/false, output: { summary: "..." } }。',
      '只输出代码块中的代码，不要包含 import 和 export。',
    ].join('\n');

    const raw = await generateTextFromProvider({
      providerId: provider.id,
      model: effectiveModel,
      system: systemPrompt,
      prompt: userMessage,
      maxTokens: 4096,
    });

    // 提取代码块内容
    const codeMatch = raw.match(/```(?:typescript|javascript|js|ts)?\s*\n([\s\S]*?)\n```/);
    const script = codeMatch ? codeMatch[1].trim() : raw.trim();

    return NextResponse.json({ script });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Codify 失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
