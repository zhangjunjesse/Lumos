import { NextRequest, NextResponse } from 'next/server';
import { getIngestJob, listIngestJobItems } from '@/lib/knowledge/ingest-queue';
import { ensureKnowledgeIngestWorker } from '@/lib/knowledge/ingest-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBoolean(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  ensureKnowledgeIngestWorker();

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const job = getIngestJob(id);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const includeItems = parseBoolean(req.nextUrl.searchParams.get('include_items'));
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 1000)) : 200;

  const items = includeItems ? listIngestJobItems(id, limit) : undefined;
  return NextResponse.json({ job, items });
}
