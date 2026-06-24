import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/db';
import { getClaudeLocalAuthStatus } from '@/lib/claude/local-auth';
import { isAnthropicProvider } from '@/lib/claude/provider-env';
import type { ErrorResponse } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  // refresh=1：绕过内存缓存强制重新探测（用户点「重新检测」或登录后轮询用）。
  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1';

  try {
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 },
      );
    }

    if (!isAnthropicProvider(provider)) {
      return NextResponse.json({
        available: false,
        authenticated: false,
        status: 'error',
        configDir: null,
        error: 'Only anthropic providers support Claude local auth status',
      });
    }

    const status = await getClaudeLocalAuthStatus({ forceRefresh });
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get Claude local auth status' },
      { status: 500 },
    );
  }
}
