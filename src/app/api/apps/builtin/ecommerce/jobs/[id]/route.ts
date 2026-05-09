import { NextRequest, NextResponse } from 'next/server';

import {
  getEcommerceStore,
  getJob,
  listOutputs,
} from '@/lib/ecommerce-assistant/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const job = getJob(store, id);
    if (!job) return NextResponse.json({ error: '任务不存在。' }, { status: 404 });
    const outputs = listOutputs(store, { job_id: id });
    return NextResponse.json({ job, outputs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
