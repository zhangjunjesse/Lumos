import { NextResponse } from 'next/server';
import { probeProvider } from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ provider: string }>;
}

/**
 * POST /api/im/probe/[provider]
 * 测试该 provider 当前 config 是否能连上。
 */
export async function POST(_req: Request, { params }: RouteParams) {
  const { provider } = await params;
  const result = await probeProvider(provider);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
