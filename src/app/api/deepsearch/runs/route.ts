import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createDeepSearchRunEntry, listDeepSearchRunsView } from '@/lib/deepsearch/service';

const createDeepSearchRunSchema = z.object({
  queryText: z.string().trim().min(1).max(4000),
  siteKeys: z.array(z.string().trim().min(1)).min(1),
  pageMode: z.enum(['takeover_active_page', 'managed_page']),
  strictness: z.enum(['strict', 'best_effort']),
  createdFrom: z.enum(['extensions', 'chat', 'workflow', 'api']).optional(),
  requestedBySessionId: z.string().trim().optional().nullable(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const limitValue = Number(request.nextUrl.searchParams.get('limit') || '50');
    const limit = Number.isFinite(limitValue) && limitValue > 0
      ? Math.min(Math.floor(limitValue), 200)
      : 50;
    const runs = await listDeepSearchRunsView(limit);
    return NextResponse.json({
      runs,
      total: runs.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list DeepSearch runs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = createDeepSearchRunSchema.parse(body);
    const run = await createDeepSearchRunEntry(input);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create DeepSearch run' },
      { status: 400 }
    );
  }
}
