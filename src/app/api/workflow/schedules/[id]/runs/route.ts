import { NextRequest, NextResponse } from 'next/server';
import { listRunHistory } from '@/lib/db/scheduled-workflows';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const runs = listRunHistory(id);
    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list runs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
