// 单发出图运行记录:GET 列出近一批「微调 / 按方向出图」的 running/完成/失败,供右下角「任务」浮层和 SOP/裂变统一展示。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { listMockupJobsForDock } from '@/lib/etsy-forge/mockup-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    return NextResponse.json({ jobs: listMockupJobsForDock(store, userId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
