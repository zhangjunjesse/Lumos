import { NextRequest, NextResponse } from 'next/server';
import {
  deleteTask,
  ensureTeamRunExecution,
  getTask,
  resumeTeamRun,
  updateTask,
  updateTeamPlanApproval,
  updateTeamRunContext,
  updateTeamRunPhase,
} from '@/lib/db/tasks';
import type { TaskResponse, ErrorResponse, UpdateTaskRequest } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body: UpdateTaskRequest = await request.json();
    const existing = getTask(id);

    if (!existing) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    const updated = body.approvalStatus
      ? updateTeamPlanApproval(id, body.approvalStatus)
      : body.resumeRun
      ? resumeTeamRun(id)
      : body.phaseId
      ? updateTeamRunPhase(id, {
          phaseId: body.phaseId,
          phaseStatus: body.phaseStatus,
          latestResult: body.phaseLatestResult,
        })
      : body.teamSummary !== undefined
        || body.finalSummary !== undefined
        || body.blockedReason !== undefined
        || body.lastError !== undefined
        || body.publishSummary
      ? updateTeamRunContext(id, {
          summary: body.teamSummary,
          finalSummary: body.finalSummary,
          blockedReason: body.blockedReason,
          lastError: body.lastError,
          publishSummary: body.publishSummary,
        })
      : updateTask(id, body);
    if (!updated) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to update task' },
        { status: 500 }
      );
    }

    return NextResponse.json<TaskResponse>({ task: updated });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to update task' },
      { status: 500 }
    );
  }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    ensureTeamRunExecution(id);
    const task = getTask(id);
    if (!task) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json<TaskResponse>({ task });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get task' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const deleted = deleteTask(id);
    if (!deleted) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to delete task' },
      { status: 500 }
    );
  }
}
