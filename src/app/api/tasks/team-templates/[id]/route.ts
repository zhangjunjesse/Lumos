import { NextRequest, NextResponse } from 'next/server';
import {
  deleteMainAgentTeamTemplate,
  updateMainAgentTeamTemplate,
} from '@/lib/db/tasks';
import type {
  ErrorResponse,
  TeamTemplateResponse,
  UpdateTeamTemplateRequest,
} from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body: UpdateTeamTemplateRequest = await request.json();
    const teamTemplate = updateMainAgentTeamTemplate(id, body);
    if (!teamTemplate) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Team template not found' },
        { status: 404 },
      );
    }

    return NextResponse.json<TeamTemplateResponse>({ teamTemplate });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to update team template' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const deleted = deleteMainAgentTeamTemplate(id);
    if (!deleted) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Team template not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to delete team template' },
      { status: 500 },
    );
  }
}
