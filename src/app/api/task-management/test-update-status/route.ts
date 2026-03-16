import { NextRequest, NextResponse } from 'next/server';
import { updateTaskStatus } from '@/lib/task-management';

/**
 * 测试用 API：手动更新任务状态
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, status } = body;

    console.log('[test-update-status] Updating task:', taskId, 'to', status);

    const result = updateTaskStatus({
      taskId,
      status,
      progress: status === 'completed' ? 100 : undefined,
      result: status === 'completed' ? { message: '任务已完成（测试）' } : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update status' },
      { status: 400 }
    );
  }
}
