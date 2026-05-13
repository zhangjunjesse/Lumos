import { NextRequest, NextResponse } from 'next/server';

import { summarizeRecentActivity } from '@/lib/douyin-collector/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const raw = Number(url.searchParams.get('hours') ?? '24');
    // Clamp the window so a user (or buggy client) can't request a 1-year
    // scan that would include every video in the library — defeats the
    // "what's new" framing.
    const hours = Math.max(1, Math.min(24 * 30, Number.isFinite(raw) ? raw : 24));
    return NextResponse.json(summarizeRecentActivity(new Date(), hours));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
