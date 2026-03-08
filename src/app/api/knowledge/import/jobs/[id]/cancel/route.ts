import { NextResponse } from 'next/server';
import { cancelIngestJob, getIngestJob } from '@/lib/knowledge/ingest-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const existing = getIngestJob(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const job = cancelIngestJob(id);
  return NextResponse.json({ job });
}
