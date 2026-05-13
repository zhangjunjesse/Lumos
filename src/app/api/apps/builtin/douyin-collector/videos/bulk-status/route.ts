import { NextRequest, NextResponse } from 'next/server';

import { COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';
import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TARGETS = ['discarded', 'unprocessed'] as const;
type AllowedTarget = (typeof ALLOWED_TARGETS)[number];

const MAX_BULK_IDS = 500;

interface BulkStatusBody {
  ids?: unknown;
  library_status?: unknown;
}

/**
 * Bulk-update library_status for a list of video ids. Restricted to the
 * two reversible transitions:
 *   - "discarded" (soft delete; no data loss; un-discard available per-card)
 *   - "unprocessed" (restore from discarded)
 * Other library_status values must go through the per-video patch route
 * so the user thinks twice about cascading changes.
 *
 * Honest contract:
 *   - Caps at MAX_BULK_IDS items per request — protects the user from
 *     accidentally toggling thousands of rows in one click.
 *   - Returns a per-id result tally so the client can show "X 成功 / Y 失败".
 *   - Missing ids count as `skipped`, not failed (they may have been
 *     deleted by a concurrent action).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as BulkStatusBody;
  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: 'ids 必须是数组。' }, { status: 400 });
  }
  const ids = body.ids
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .slice(0, MAX_BULK_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids 为空。' }, { status: 400 });
  }
  const target = body.library_status;
  if (typeof target !== 'string' || !(ALLOWED_TARGETS as readonly string[]).includes(target)) {
    return NextResponse.json(
      { error: `library_status 必须是 ${ALLOWED_TARGETS.join(' / ')} 之一。` },
      { status: 400 },
    );
  }

  const store = getDouyinCollectorStore();
  const now = new Date().toISOString();
  let updated = 0;
  let skipped = 0;
  for (const id of ids) {
    const r = store.update(COLLECTION_VIDEOS, id, {
      library_status: target as AllowedTarget,
      updated_at: now,
    });
    if (r) updated += 1;
    else skipped += 1;
  }
  return NextResponse.json({ ok: true, updated, skipped, target });
}
