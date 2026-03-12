import { NextRequest, NextResponse } from 'next/server';
import { createMainAgentTeamTemplate } from '@/lib/db/tasks';
import type {
  CreateTeamTemplateRequest,
  ErrorResponse,
  TeamTemplateResponse,
} from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body: CreateTeamTemplateRequest = await request.json();
    const teamTemplate = createMainAgentTeamTemplate(body);
    return NextResponse.json<TeamTemplateResponse>({ teamTemplate }, { status: 201 });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to create team template' },
      { status: 500 },
    );
  }
}
