import { NextResponse } from 'next/server';

import { countLibraryBacklog, countLibraryStatus } from '@/lib/douyin-collector/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Single endpoint serving both the backlog chip counts (Round 79) and
 * the per-status counts (Round 108). Co-located because callers always
 * want them together — the Library tab renders both above the cards.
 */
export async function GET() {
  try {
    return NextResponse.json({
      ...countLibraryBacklog(),
      statusCounts: countLibraryStatus(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
