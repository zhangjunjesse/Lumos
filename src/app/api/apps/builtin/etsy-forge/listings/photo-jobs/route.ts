// 图片生成任务：GET ?listingId= 列出(轮询进度) / DELETE ?id= 删除(客户端消费成功结果后删，或清失败)。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { deletePhotoJob, listPhotoJobs } from '@/lib/etsy-forge/listing/photo-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const listingId = new URL(req.url).searchParams.get('listingId') ?? undefined;
    const store = getEtsyForgeStore();
    return NextResponse.json({ jobs: listPhotoJobs(store, getStorageUserId(req), listingId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: deletePhotoJob(store, getStorageUserId(req), id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
