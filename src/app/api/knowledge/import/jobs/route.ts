import { NextRequest, NextResponse } from 'next/server';
import { clearIngestJobs, listIngestJobs } from '@/lib/knowledge/ingest-queue';
import { ensureKnowledgeIngestWorker } from '@/lib/knowledge/ingest-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBoolean(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function GET(req: NextRequest) {
  ensureKnowledgeIngestWorker();

  const collectionId = req.nextUrl.searchParams.get('collection_id') || undefined;
  const activeOnly = parseBoolean(req.nextUrl.searchParams.get('active'));
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 12);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 100)) : 12;

  const jobs = listIngestJobs({ collectionId, activeOnly, limit });
  return NextResponse.json({ jobs });
}

export async function DELETE() {
  const cleared = clearIngestJobs();
  return NextResponse.json({ ok: true, ...cleared });
}
