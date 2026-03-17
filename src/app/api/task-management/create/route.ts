import { NextRequest, NextResponse } from 'next/server';
import { createTask, CreateTaskRequest } from '@/lib/task-management';

export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskRequest = await request.json();
    console.log('[task-management-api] POST /api/task-management/create');
    console.log('[task-management-api] Request body:', JSON.stringify(body, null, 2));

    const result = createTask(body);
    console.log('[task-management-api] Task created:', result.taskId);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('[task-management-api] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 400 }
    );
  }
}
