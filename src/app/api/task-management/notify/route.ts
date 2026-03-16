import { NextRequest, NextResponse } from 'next/server';
import { NotifyTaskCompletionRequest } from '@/lib/task-management';

/**
 * 任务完成通知接口
 * 由Task Management调用，触发Main Agent生成对话消息通知用户
 */
export async function POST(request: NextRequest) {
  try {
    const body: NotifyTaskCompletionRequest = await request.json();
    const { sessionId, notification } = body;

    // TODO: 实现实际的通知逻辑
    // 1. 获取会话上下文
    // 2. 构造task_completed事件消息
    // 3. 调用Main Agent生成响应
    // 4. 将响应插入到会话中

    console.log('[task-notify] Task completion notification received:', {
      sessionId,
      taskId: notification.taskId,
      status: notification.status,
    });

    // Mock: 返回成功
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to notify' },
      { status: 500 }
    );
  }
}
