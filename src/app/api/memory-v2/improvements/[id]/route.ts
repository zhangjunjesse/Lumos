import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getMemoryV2ImprovementCandidate,
  parseImprovementMetadata,
  parseImprovementSourceMemoryIds,
  updateMemoryV2ImprovementCandidate,
} from '@/lib/memory-v2/self-improvement';
import type { MemoryV2ImprovementCandidate } from '@/lib/memory-v2/self-improvement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  candidateType: z.enum(['skill', 'mcp', 'workflow', 'prompt', 'rule']).optional(),
  status: z.enum(['candidate', 'approved', 'building', 'built', 'rejected', 'failed']).optional(),
  title: z.string().trim().min(1).max(180).optional(),
  problem: z.string().trim().min(1).max(3000).optional(),
  evidence: z.string().trim().max(2400).optional(),
  proposedCapability: z.string().trim().min(1).max(3000).optional(),
  sourceMemoryIds: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  builderSessionId: z.string().trim().max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const candidate = getMemoryV2ImprovementCandidate(id);
  if (!candidate) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ candidate: serialize(candidate) });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const input = updateSchema.parse(body);
    const candidate = updateMemoryV2ImprovementCandidate(id, input);
    if (!candidate) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ candidate: serialize(candidate) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update improvement candidate';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
