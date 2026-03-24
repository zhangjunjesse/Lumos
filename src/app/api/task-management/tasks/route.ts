import { NextRequest, NextResponse } from 'next/server';
import { listTasks } from '@/lib/task-management';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId')?.trim() || undefined;
    const sourceMessageId = searchParams.get('sourceMessageId')?.trim() || undefined;
    const limitValue = Number(searchParams.get('limit') || '50');
    const limit = Number.isFinite(limitValue) && limitValue > 0
      ? Math.min(Math.floor(limitValue), 100)
      : 50;

    const result = listTasks({ sessionId, sourceMessageId, limit });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list tasks' },
      { status: 500 }
    );
  }
}
