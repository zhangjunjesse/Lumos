import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  generateMemoryV2ImprovementCandidates,
  listMemoryV2ImprovementCandidates,
  parseImprovementMetadata,
  parseImprovementSourceMemoryIds,
} from '@/lib/memory-v2/self-improvement';
import type { MemoryV2ImprovementCandidate } from '@/lib/memory-v2/self-improvement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const typeSchema = z.enum(['skill', 'mcp', 'workflow', 'prompt', 'rule']);
const statusSchema = z.enum(['candidate', 'approved', 'building', 'built', 'rejected', 'failed']);

function serialize(candidate: MemoryV2ImprovementCandidate) {
  return {
    id: candidate.id,
    candidateType: candidate.candidate_type,
    status: candidate.status,
    title: candidate.title,
    problem: candidate.problem,
    evidence: candidate.evidence,
    proposedCapability: candidate.proposed_capability,
    sourceMemoryIds: parseImprovementSourceMemoryIds(candidate.source_memory_ids),
    riskLevel: candidate.risk_level,
    builderSessionId: candidate.builder_session_id,
    fingerprint: candidate.fingerprint,
    metadata: parseImprovementMetadata(candidate.metadata),
    createdAt: candidate.created_at,
    updatedAt: candidate.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const status = url.searchParams.get('status') || undefined;
    const candidateType = url.searchParams.get('type') || undefined;
    const limitRaw = Number(url.searchParams.get('limit') || '');
    const candidates = listMemoryV2ImprovementCandidates({
      status: status === 'all' || statusSchema.safeParse(status).success ? status as never : undefined,
      candidateType: candidateType === 'all' || typeSchema.safeParse(candidateType).success ? candidateType as never : undefined,
      query: url.searchParams.get('q') || undefined,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100,
    });
    return NextResponse.json({
      candidates: candidates.map(serialize),
      total: candidates.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list improvement candidates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = generateMemoryV2ImprovementCandidates();
    return NextResponse.json({
      scanned: result.scanned,
      created: result.created.map(serialize),
      candidates: result.candidates.map(serialize),
      total: result.candidates.length,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate improvement candidates';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
