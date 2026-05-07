import { NextRequest, NextResponse } from 'next/server';

import { getMessageContext } from '@/lib/wechat-assistant/mirror-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const wxid = (params.get('wxid') ?? '').trim();
  const ts = Number(params.get('ts') ?? '0');
  const radius = clampInt(params.get('radius'), 1, 30, 8);

  if (!wxid || !Number.isFinite(ts) || ts <= 0) {
    return NextResponse.json({ error: 'invalid_context_request' }, { status: 400 });
  }

  const context = getMessageContext(wxid, ts, radius);
  if (!context) {
    return NextResponse.json({ error: 'context_not_found' }, { status: 404 });
  }

  return NextResponse.json({ context });
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
