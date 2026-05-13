import { NextRequest, NextResponse } from 'next/server';

import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import { CREATOR_CADENCES, COLLECTION_CREATORS } from '@/lib/douyin-collector/constants';
import type { CreatorCadence, CreatorRecord } from '@/lib/douyin-collector/types';
import { cancelPendingJobsForTarget } from '@/lib/douyin-collector/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<CreatorRecord> = {};
    if (typeof body.nickname === 'string') patch.nickname = body.nickname.trim();
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.cadence === 'string') {
      if (!(CREATOR_CADENCES as readonly string[]).includes(body.cadence)) {
        return NextResponse.json({ error: 'cadence 取值非法。' }, { status: 400 });
      }
      patch.cadence = body.cadence as CreatorCadence;
    }
    patch.updated_at = new Date().toISOString();

    const store = getDouyinCollectorStore();
    // Disabling a subscription should cancel any pending collect_jobs —
    // user toggled off to "stop everything", not "let already-buffered
    // jobs play out". Read prior state to detect the true→false edge;
    // re-saving enabled=false on already-disabled is a no-op.
    const prior = store.get<CreatorRecord>(COLLECTION_CREATORS, id);
    const willDisable =
      patch.enabled === false && !!prior && prior.enabled !== false;
    const updated = store.update<CreatorRecord>(COLLECTION_CREATORS, id, patch);
    if (!updated) return NextResponse.json({ error: '博主不存在。' }, { status: 404 });
    let cancelledJobs = 0;
    if (willDisable) {
      cancelledJobs = cancelPendingJobsForTarget(
        'creator',
        id,
        '博主订阅已暂停，跳过此采集任务。',
      );
    }
    return NextResponse.json({ creator: updated, cancelledJobs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const store = getDouyinCollectorStore();
    // Cancel any queued/running collect_jobs first so the runner doesn't
    // pick them up and confusingly report "该博主没有 sec_uid" — the
    // parent's gone, not malformed. Per CLAUDE.md task-lifecycle rules:
    // delete must cancel pending sub-tasks before removing the record.
    const cancelled = cancelPendingJobsForTarget('creator', id, '博主订阅已删除，跳过此采集任务。');
    const ok = store.delete(COLLECTION_CREATORS, id);
    if (!ok) return NextResponse.json({ error: '博主不存在。' }, { status: 404 });
    return NextResponse.json({ ok: true, cancelledJobs: cancelled });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
