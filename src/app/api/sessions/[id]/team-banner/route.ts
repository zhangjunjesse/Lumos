import { NextResponse } from 'next/server';
import { ensureSessionTeamRunsExecution } from '@/lib/db/tasks';
import { getSessionTeamBannerProjection } from '@/lib/team-run/projections';
import type { ErrorResponse, TeamBannerProjectionResponseV1 } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    ensureSessionTeamRunsExecution(id);
    return NextResponse.json<TeamBannerProjectionResponseV1>({
      banner: getSessionTeamBannerProjection(id),
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to load team banner' },
      { status: 500 },
    );
  }
}
