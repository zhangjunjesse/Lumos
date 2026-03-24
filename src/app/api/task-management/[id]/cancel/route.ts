import { NextRequest, NextResponse } from 'next/server';
import { cancelTask } from '@/lib/task-management';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const result = await cancelTask({ taskId: id, reason: body.reason });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel task' },
      { status: 400 }
    );
  }
}
