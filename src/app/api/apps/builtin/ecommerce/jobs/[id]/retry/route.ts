import { NextRequest, NextResponse } from 'next/server';

import { retryJob } from '@/lib/ecommerce-assistant/job-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const job = await retryJob(id);
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
