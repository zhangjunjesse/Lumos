import { NextRequest, NextResponse } from 'next/server';
import { hasProvider, setProviderEnabled, isProviderEnabled } from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ provider: string }>;
}

/**
 * POST /api/im/enable/[provider]
 * body: { enabled: boolean }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { provider } = await params;
    if (!hasProvider(provider)) {
      return NextResponse.json({ error: 'unknown provider' }, { status: 404 });
    }
    const body = (await req.json()) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
    }
    setProviderEnabled(provider, body.enabled);
    return NextResponse.json({ enabled: isProviderEnabled(provider) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to toggle';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
