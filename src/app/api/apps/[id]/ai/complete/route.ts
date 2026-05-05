import { type NextRequest, NextResponse } from 'next/server';

import { getProviderModelOptions } from '@/lib/model-metadata';
import { ProviderResolutionError, resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateTextFromProvider } from '@/lib/text-generator';

interface CompleteOptions {
  model?: unknown;
  system?: unknown;
  maxTokens?: unknown;
  temperature?: unknown;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { prompt?: unknown; opts?: CompleteOptions };
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    const provider = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: 'text-gen',
    });
    if (!provider) {
      return NextResponse.json(
        { error: '未配置可用的文本生成服务商，请先到设置里选择支持文本生成的服务商。' },
        { status: 409 },
      );
    }

    const opts = body.opts ?? {};
    const fallbackModel = getProviderModelOptions(provider)[0]?.value?.trim() || '';
    const requestedModel = typeof opts.model === 'string' && opts.model.trim()
      ? opts.model.trim()
      : fallbackModel;
    if (!requestedModel) {
      return NextResponse.json(
        { error: `服务商“${provider.name}”没有可用模型，请先在设置里配置模型。` },
        { status: 409 },
      );
    }

    const system = typeof opts.system === 'string' && opts.system.trim()
      ? opts.system.trim()
      : '你是 Lumos 应用内的 AI 助手。请直接回答用户请求。';
    const text = await generateTextFromProvider({
      providerId: provider.id,
      model: requestedModel,
      system,
      prompt,
      maxTokens: normalizeMaxTokens(opts.maxTokens),
      temperature: normalizeTemperature(opts.temperature),
      abortSignal: AbortSignal.timeout(120_000),
    });

    return NextResponse.json({ text, appId: id, providerId: provider.id, model: requestedModel });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 生成失败';
    const status = error instanceof ProviderResolutionError ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function normalizeMaxTokens(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(128, Math.min(12000, Math.floor(value)));
}

function normalizeTemperature(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(2, value));
}
