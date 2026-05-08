import { NextResponse } from 'next/server';
import {
  buildMemoryV2ReflectionReport,
  createMemoryV2ReflectionEntry,
} from '@/lib/memory-v2/reflection';
import { parseMemoryV2Tags } from '@/lib/memory-v2/store';
import type { MemoryV2Entry } from '@/lib/memory-v2/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(entry: MemoryV2Entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    scopeType: entry.scope_type,
    scopeKey: entry.scope_key,
    ownerModule: entry.owner_module,
    status: entry.status,
    title: entry.title,
    body: entry.body,
    summary: entry.summary,
    tags: parseMemoryV2Tags(entry.tags),
    sensitivity: entry.sensitivity,
    secretRef: entry.secret_ref,
    confidence: entry.confidence,
    importance: entry.importance,
    evidence: entry.evidence,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    lastUsedAt: entry.last_used_at,
    hitCount: entry.hit_count,
  };
}

export async function GET() {
  try {
    return NextResponse.json({ report: buildMemoryV2ReflectionReport() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build Memory v2 reflection report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = createMemoryV2ReflectionEntry();
    return NextResponse.json({
      report: result.report,
      memory: serialize(result.memory),
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Memory v2 reflection entry';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
