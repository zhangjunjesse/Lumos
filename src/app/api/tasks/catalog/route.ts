import { NextResponse } from 'next/server';
import { ensureMainAgentTeamRunsExecution, getMainAgentCatalog } from '@/lib/db/tasks';
import type { ErrorResponse, MainAgentCatalogResponse } from '@/types';

export async function GET() {
  try {
    ensureMainAgentTeamRunsExecution();
    const catalog = getMainAgentCatalog();
    return NextResponse.json<MainAgentCatalogResponse>(catalog);
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to load task catalog' },
      { status: 500 },
    );
  }
}
