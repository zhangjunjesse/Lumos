import { NextRequest, NextResponse } from 'next/server';
import { TEAM_PLAN_TASK_KIND } from '@/types';
import { createTask, ensureSessionTeamRunsExecution, getTasksBySession } from '@/lib/db/tasks';
import type { TasksResponse, TaskResponse, ErrorResponse, CreateTaskRequest } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sessionId = searchParams.get('session_id');
  const kind = searchParams.get('kind');
  const includeSystem = searchParams.get('include_system') === '1';

  if (!sessionId) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing session_id parameter' },
      { status: 400 }
    );
  }

  try {
    ensureSessionTeamRunsExecution(sessionId);
    const tasks = getTasksBySession(sessionId, {
      ...(kind === TEAM_PLAN_TASK_KIND ? { kind: TEAM_PLAN_TASK_KIND } : {}),
      includeSystem,
    });
    return NextResponse.json<TasksResponse>({ tasks });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskRequest = await request.json();

    if (!body.session_id || !body.title) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing session_id or title' },
        { status: 400 }
      );
    }

    const task = createTask(body.session_id, body.title, body.description);
    return NextResponse.json<TaskResponse>({ task }, { status: 201 });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}
