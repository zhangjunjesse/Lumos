import { NextRequest, NextResponse } from 'next/server';
import { getDefaultProviderId, setDefaultProviderId, hasProvider } from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/im/default
 */
export async function GET() {
  return NextResponse.json({ provider: getDefaultProviderId() });
}

/**
 * PUT /api/im/default
 * body: { provider: string | null }
 */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { provider?: unknown };
    if (body.provider === null || body.provider === '') {
      setDefaultProviderId(null);
      return NextResponse.json({ provider: null });
    }
    if (typeof body.provider !== 'string') {
      return NextResponse.json({ error: 'provider must be string or null' }, { status: 400 });
    }
    if (!hasProvider(body.provider)) {
      return NextResponse.json({ error: 'unknown provider' }, { status: 404 });
    }
    setDefaultProviderId(body.provider);
    return NextResponse.json({ provider: body.provider });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set default';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
