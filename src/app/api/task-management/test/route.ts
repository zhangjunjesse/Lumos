import { NextRequest, NextResponse } from 'next/server';
import { createTask, listTasks, getTaskDetail } from '@/lib/task-management';

export async function GET(request: NextRequest) {
  try {
    console.log('[test-task-api] Running Task Management test...');

    // 1. 创建任务
    const createResult = createTask({
      taskSummary: '生成AI医疗领域调研报告',
      requirements: ['重点关注医疗领域', '包含案例分析'],
      context: {
        sessionId: 'test_session_' + Date.now(),
      },
    });

    // 2. 查询任务列表
    const listResult = listTasks({ limit: 10 });

    // 3. 获取任务详情
    const detailResult = getTaskDetail({ taskId: createResult.taskId });

    return NextResponse.json({
      success: true,
      results: {
        created: createResult,
        list: listResult,
        detail: detailResult,
      },
    });
  } catch (error) {
    console.error('[test-task-api] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Test failed'
      },
      { status: 500 }
    );
  }
}
