import { NextRequest, NextResponse } from 'next/server';
import * as tagStore from '@/lib/stores/tag-store';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const fromId = typeof body.from_id === 'string' ? body.from_id.trim() : '';
  const toId = typeof body.to_id === 'string' ? body.to_id.trim() : '';
  if (!fromId || !toId) {
    return NextResponse.json({ error: 'from_id and to_id required' }, { status: 400 });
  }
  if (fromId === toId) {
    return NextResponse.json({ error: 'from_id and to_id must differ' }, { status: 400 });
  }

  const fromTag = tagStore.getTag(fromId);
  const toTag = tagStore.getTag(toId);
  if (!fromTag) return NextResponse.json({ error: 'from tag not found' }, { status: 404 });
  if (!toTag) return NextResponse.json({ error: 'to tag not found' }, { status: 404 });

  const affectedItemIds = Array.from(
    new Set([...tagStore.getItemsByTag(fromId), ...tagStore.getItemsByTag(toId)]),
  );

  const { merged } = tagStore.mergeTag(fromId, toId);
  tagStore.rebuildItemTagsJson(affectedItemIds);

  return NextResponse.json({
    ok: true,
    from: fromTag.name,
    to: toTag.name,
    merged,
    affected: affectedItemIds.length,
  });
}
