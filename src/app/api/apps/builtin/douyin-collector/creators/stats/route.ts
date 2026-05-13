import { NextResponse } from 'next/server';

import { statsByCreator } from '@/lib/douyin-collector/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const map = statsByCreator();
    return NextResponse.json({ stats: Object.fromEntries(map) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
