import { NextRequest, NextResponse } from 'next/server';
import {
  deleteMainAgentAgentPreset,
  updateMainAgentAgentPreset,
} from '@/lib/db/tasks';
import type {
  AgentPresetResponse,
  ErrorResponse,
  UpdateAgentPresetRequest,
} from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body: UpdateAgentPresetRequest = await request.json();
    const agentPreset = updateMainAgentAgentPreset(id, body);
    if (!agentPreset) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Agent preset not found' },
        { status: 404 },
      );
    }

    return NextResponse.json<AgentPresetResponse>({ agentPreset });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to update agent preset' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const deleted = deleteMainAgentAgentPreset(id);
    if (!deleted) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Agent preset not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to delete agent preset' },
      { status: 500 },
    );
  }
}
