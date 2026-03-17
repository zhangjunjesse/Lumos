import { NextRequest, NextResponse } from 'next/server';
import { getTaskDetail } from '@/lib/task-management';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = getTaskDetail({ taskId: id });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Task not found' },
      { status: 404 }
    );
  }
}
