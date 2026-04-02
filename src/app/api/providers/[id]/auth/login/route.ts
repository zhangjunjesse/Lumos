import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/db';
import { startClaudeLocalAuthSetup } from '@/lib/claude/local-auth';
import { isAnthropicProvider } from '@/lib/claude/provider-env';
import type { ErrorResponse } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 },
      );
    }

    if (!isAnthropicProvider(provider)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Only anthropic providers can start Claude local auth login' },
        { status: 400 },
      );
    }

    const started = startClaudeLocalAuthSetup();
    return NextResponse.json({
      success: true,
      configDir: started.configDir,
      command: started.command,
      message: '已打开 Claude 登录终端。请在浏览器完成授权；Lumos 会自动刷新登录状态。若终端最终停在 Claude 输入界面，可直接关闭该窗口。',
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to start Claude local auth login' },
      { status: 500 },
    );
  }
}
