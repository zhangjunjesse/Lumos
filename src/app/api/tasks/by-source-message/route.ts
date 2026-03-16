import { NextRequest, NextResponse } from 'next/server';
import { ensureTeamRunExecution, getTeamPlanTaskBySourceMessageId } from '@/lib/db/tasks';
import { getTaskViewProjection } from '@/lib/team-run/projections';
import type { ErrorResponse, TaskDetailProjectionResponseV1 } from '@/types';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id')?.trim() || '';
  const sourceMessageId = request.nextUrl.searchParams.get('source_message_id')?.trim() || '';

  if (!sessionId || !sourceMessageId) {
    return NextResponse.json<ErrorResponse>(
      { error: 'session_id and source_message_id are required' },
      { status: 400 },
    );
  }

  try {
    const task = getTeamPlanTaskBySourceMessageId(sessionId, sourceMessageId);
    if (!task) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 },
      );
    }

    ensureTeamRunExecution(task.id);
    const projection = getTaskViewProjection(task.id);
    if (!projection) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 },
      );
    }

    return NextResponse.json<TaskDetailProjectionResponseV1>(projection);
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to load task view' },
      { status: 500 },
    );
  }
}
