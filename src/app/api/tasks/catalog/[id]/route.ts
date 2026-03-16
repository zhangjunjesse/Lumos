import { NextResponse } from 'next/server';
import { ensureTeamRunExecution } from '@/lib/db/tasks';
import { getTaskCatalogItemProjection } from '@/lib/team-run/projections';
import type { ErrorResponse, TaskDirectoryItem } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    ensureTeamRunExecution(id);
    const task = getTaskCatalogItemProjection(id);
    if (!task) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 },
      );
    }

    return NextResponse.json<{ task: TaskDirectoryItem }>({ task });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to load task' },
      { status: 500 },
    );
  }
}
