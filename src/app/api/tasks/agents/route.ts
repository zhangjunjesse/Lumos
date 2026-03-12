import { NextRequest, NextResponse } from 'next/server';
import { createMainAgentAgentPreset } from '@/lib/db/tasks';
import type {
  AgentPresetResponse,
  CreateAgentPresetRequest,
  ErrorResponse,
} from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body: CreateAgentPresetRequest = await request.json();
    const agentPreset = createMainAgentAgentPreset(body);
    return NextResponse.json<AgentPresetResponse>({ agentPreset }, { status: 201 });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to create agent preset' },
      { status: 500 },
    );
  }
}
