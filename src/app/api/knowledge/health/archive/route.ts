import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * POST /api/knowledge/health/archive
 * Batch archive knowledge items.
 */
export async function POST(req: NextRequest) {
  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 });
  }

  const db = getDb();
  const now = new Date().toISOString();
  let archived = 0;

  for (const id of ids) {
    const r = db.prepare(
      'UPDATE kb_items SET health_status=?, health_reason=?, health_checked_at=? WHERE id=?'
    ).run('archived', 'Manual archive', now, id);
    if (r.changes > 0) archived++;
  }

  return NextResponse.json({ archived });
}
