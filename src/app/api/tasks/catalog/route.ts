import { NextResponse } from 'next/server';
import { ensureMainAgentTeamRunsExecution } from '@/lib/db/tasks';
import { getMainAgentCatalogProjection } from '@/lib/team-run/projections';
import type { ErrorResponse, MainAgentCatalogResponse } from '@/types';

export async function GET() {
  try {
    ensureMainAgentTeamRunsExecution();
    const catalog = getMainAgentCatalogProjection();
    return NextResponse.json<MainAgentCatalogResponse>(catalog);
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to load task catalog' },
      { status: 500 },
    );
  }
}
