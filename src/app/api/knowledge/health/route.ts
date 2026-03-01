import { NextResponse } from 'next/server';
import { checkAllHealth } from '@/lib/knowledge/health-checker';
import { getDb } from '@/lib/db';

/**
 * GET /api/knowledge/health
 * Knowledge health overview: stats + suggestion list.
 */
export async function GET() {
  const scores = checkAllHealth();

  const db = getDb();
  const totalItems = (db.prepare(
    'SELECT COUNT(*) as c FROM kb_items'
  ).get() as { c: number }).c;

  const healthy = scores.filter(s => !s.isStale && !s.shouldArchive).length;
  const stale = scores.filter(s => s.isStale).length;
  const archivable = scores.filter(s => s.shouldArchive).length;

  const suggestions = scores
    .filter(s => s.isStale || s.shouldArchive)
    .map(s => ({
      itemId: s.itemId,
      activity: s.activity,
      reasons: s.reasons,
      action: s.shouldArchive ? 'archive' : 'review',
    }));

  return NextResponse.json({
    total: totalItems,
    healthy,
    stale,
    archivable,
    suggestions,
  });
}
