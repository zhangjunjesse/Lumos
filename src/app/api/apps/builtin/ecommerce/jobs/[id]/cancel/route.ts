import { NextRequest, NextResponse } from 'next/server';

import { cancelJob } from '@/lib/ecommerce-assistant/job-runner';
import { getEcommerceStore, getJob, patchJob } from '@/lib/ecommerce-assistant/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getEcommerceStore();
  const job = getJob(store, id);
  if (!job) return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
  const aborted = cancelJob(id);
  if (!aborted && job.status !== 'completed' && job.status !== 'failed') {
    patchJob(store, id, {
      status: 'cancelled',
      stage: 'cancelled',
      failure_reason: '任务被用户取消',
      failure_stage: 'cancelled',
    });
  }
  const updated = getJob(store, id);
  return NextResponse.json({ job: updated, aborted });
}
