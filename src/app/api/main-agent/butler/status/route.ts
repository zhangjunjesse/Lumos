import { NextRequest } from 'next/server';
import { buildLumosStatus } from '@/lib/tools/lumos-butler-mcp-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const includeRecent = request.nextUrl.searchParams.get('include_recent') !== 'false';
    const currentSessionId = request.nextUrl.searchParams.get('session_id')?.trim() || undefined;
    return Response.json(buildLumosStatus({ currentSessionId, includeRecent }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/main-agent/butler/status] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
