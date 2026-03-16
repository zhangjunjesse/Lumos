import { NextResponse } from 'next/server';
import { ensureRunScheduled } from '@/lib/team-run/runtime-manager';
import { getTeamRunDetailProjection } from '@/lib/team-run/projections';
import type { ErrorResponse, TeamRunDetailProjectionResponseV1 } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    ensureRunScheduled(id);
    const team = getTeamRunDetailProjection(id);
    if (!team) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Run not found' },
        { status: 404 },
      );
    }

    return NextResponse.json<TeamRunDetailProjectionResponseV1>({ team });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to load team run view' },
      { status: 500 },
    );
  }
}
