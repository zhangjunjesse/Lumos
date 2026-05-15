import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { recordCapabilityResearchCandidate } from '@/lib/memory-v2/capability-lab';
import { summarizeNewMemoryV2CapabilityEvents } from '@/lib/memory-v2/capability-events';
import { generateMemoryV2ImprovementCandidates } from '@/lib/memory-v2/self-improvement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const researchSchema = z.object({
  capabilityType: z.enum(['skill', 'mcp']),
  capabilityName: z.string().trim().min(1).max(120),
  source: z.enum(['manual', 'github', 'deepsearch', 'douyin']),
  sourceUrl: z.string().trim().max(1000).optional(),
  title: z.string().trim().max(240).optional(),
  summary: z.string().trim().max(1200).optional(),
  evidence: z.string().trim().max(4000).optional(),
  tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
  autoDownload: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = researchSchema.parse(body);
    const result = await recordCapabilityResearchCandidate(input);
    const memorySummary = summarizeNewMemoryV2CapabilityEvents();
    const improvements = generateMemoryV2ImprovementCandidates();
    return NextResponse.json({
      recorded: result.recorded,
      downloaded: result.downloaded,
      staged: result.staged
        ? {
            importId: result.staged.importId,
            rootPath: result.staged.rootPath,
            writtenFiles: result.staged.writtenFiles,
            downloadKind: result.staged.downloadKind,
            fetchedUrl: result.staged.fetchedUrl,
          }
        : null,
      memorySummary: {
        scanned: memorySummary.scanned,
        created: memorySummary.created.length,
        maxRowId: memorySummary.maxRowId,
      },
      improvementsCreated: improvements.created.length,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record capability research candidate';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
