import { NextRequest, NextResponse } from 'next/server';
import {
  getDefaultProviderId,
  getEnabledProviders,
  hasProvider,
  setDefaultProviderId,
} from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/im/default
 *
 * Returns:
 *   provider:   the explicitly configured default (null when user hasn't set one)
 *   effective:  what the UI should treat as the active IM right now —
 *               explicit default → first enabled provider → null
 *
 * UI 单选规则（chat header 一次只展示一个 IM 的入口）依赖 effective。
 */
export async function GET() {
  const explicit = getDefaultProviderId();
  let effective = explicit && hasProvider(explicit) ? explicit : null;
  if (!effective) {
    const enabled = getEnabledProviders().filter((id) => hasProvider(id));
    effective = enabled[0] ?? null;
  }
  return NextResponse.json({ provider: explicit, effective });
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
