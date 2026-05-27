import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type RunRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind') ?? undefined;
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

    const filter: Record<string, unknown> = {};
    if (kind) filter.kind = kind;

    const store = getEtsyForgeStore();
    const rows = store.query<RunRow>(COLLECTIONS.RUNS, {
      filter,
      orderBy: { field: 'started_at', direction: 'desc' },
      limit,
    });

    return NextResponse.json({
      runs: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        strategy: r.strategy,
        status: r.status,
        generated_count: r.generated_count,
        succeeded_count: r.succeeded_count,
        failed_count: r.failed_count,
        liked_count: r.liked_count,
        quota_spent: r.quota_spent,
        failure_reason: r.failure_reason,
        themes: safeParseArray(r.themes_json),
        started_at: r.started_at,
        ended_at: r.ended_at,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function safeParseArray(s: string | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
