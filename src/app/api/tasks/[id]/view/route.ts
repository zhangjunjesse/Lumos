import { NextResponse } from 'next/server';
import { ensureTeamRunExecution } from '@/lib/db/tasks';
import { getTaskViewProjection } from '@/lib/team-run/projections';
import type { ErrorResponse, TaskDetailProjectionResponseV1 } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    ensureTeamRunExecution(id);
    const projection = getTaskViewProjection(id);
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
