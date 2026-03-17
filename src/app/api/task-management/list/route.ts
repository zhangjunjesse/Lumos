import { NextRequest, NextResponse } from 'next/server';
import { listTasks, TaskStatus } from '@/lib/task-management';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId') || undefined;
    const statusParam = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const status = statusParam
      ? statusParam.split(',').filter(s => Object.values(TaskStatus).includes(s as TaskStatus)) as TaskStatus[]
      : undefined;

    const result = listTasks({ sessionId, status, limit, offset });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list tasks' },
      { status: 500 }
    );
  }
}
