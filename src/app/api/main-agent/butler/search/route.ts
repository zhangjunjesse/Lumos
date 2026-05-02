import { NextRequest } from 'next/server';
import { searchLumosHistory } from '@/lib/tools/lumos-butler-mcp-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEARCH_SCOPES = new Set([
  'all',
  'sessions',
  'messages',
  'tasks',
  'workflows',
  'deepsearch',
  'capabilities',
]);

export async function GET(request: NextRequest) {
  try {
    const query = (request.nextUrl.searchParams.get('q') || request.nextUrl.searchParams.get('query') || '').trim();
    if (!query) {
      return Response.json({ error: 'query is required' }, { status: 400 });
    }

    const rawScope = request.nextUrl.searchParams.get('scope') || 'all';
    const scope = SEARCH_SCOPES.has(rawScope) ? rawScope : 'all';
    const rawLimit = request.nextUrl.searchParams.get('limit');
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;

    return Response.json(searchLumosHistory({
      query,
      scope: scope as Parameters<typeof searchLumosHistory>[0]['scope'],
      limit: Number.isFinite(limit) ? limit : undefined,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/main-agent/butler/search] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
