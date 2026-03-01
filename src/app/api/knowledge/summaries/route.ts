import { NextRequest, NextResponse } from 'next/server';
import * as summaryStore from '@/lib/stores/summary-store';

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope') as summaryStore.SummaryScope | null;
  const limit = Number(req.nextUrl.searchParams.get('limit')) || 50;
  const offset = Number(req.nextUrl.searchParams.get('offset')) || 0;

  const summaries = summaryStore.listSummaries({
    scope: scope || undefined,
    limit,
    offset,
  });
  return NextResponse.json(summaries);
}
