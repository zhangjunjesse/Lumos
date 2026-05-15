import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  downloadStageAndScanThirdPartyCapability,
  getMemoryV2CapabilityLabRoot,
  stageAndScanThirdPartyCapability,
  type CapabilityLabScanResult,
} from '@/lib/memory-v2/capability-lab';
import { summarizeNewMemoryV2CapabilityEvents } from '@/lib/memory-v2/capability-events';
import { generateMemoryV2ImprovementCandidates } from '@/lib/memory-v2/self-improvement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const capabilityTypeSchema = z.enum(['skill', 'mcp']);

const fileSchema = z.object({
  path: z.string().trim().min(1).max(240),
  content: z.string().max(512 * 1024),
});

const stageSchema = z.object({
  capabilityType: capabilityTypeSchema,
  capabilityName: z.string().trim().min(1).max(120),
  sourceUrl: z.string().trim().max(1000).optional(),
  source: z.string().trim().max(120).optional(),
  download: z.boolean().optional(),
  files: z.array(fileSchema).min(1).max(80).optional(),
  content: z.string().max(512 * 1024).optional(),
});

function serializeScan(scan: CapabilityLabScanResult) {
  return {
    capabilityType: scan.capabilityType,
    capabilityName: scan.capabilityName,
    rootPath: scan.rootPath,
    sourceUrl: scan.sourceUrl,
    filesScanned: scan.filesScanned,
    bytesScanned: scan.bytesScanned,
    verdict: scan.verdict,
    riskLevel: scan.riskLevel,
    findings: scan.findings,
    policy: scan.policy,
    patterns: scan.patterns,
    rewriteTarget: scan.rewriteTarget,
  };
}

export async function GET() {
  return NextResponse.json({
    rootPath: getMemoryV2CapabilityLabRoot(),
    mode: 'isolated-research',
    installState: 'not_installed',
    supportedActions: ['stage_files', 'static_scan', 'record_rewrite_plan'],
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = stageSchema.parse(body);
    const files = input.files && input.files.length > 0
      ? input.files
      : input.content
        ? [{ path: input.capabilityType === 'skill' ? 'SKILL.md' : 'README.md', content: input.content }]
        : [];
    if (files.length === 0) {
      if (!input.download || !input.sourceUrl) {
        return NextResponse.json({ error: 'files, content, or download sourceUrl is required' }, { status: 400 });
      }
    }
    const result = input.download && input.sourceUrl && files.length === 0
      ? await downloadStageAndScanThirdPartyCapability({
          capabilityType: input.capabilityType,
          capabilityName: input.capabilityName,
          sourceUrl: input.sourceUrl,
          source: input.source || 'memory-v2-capability-lab-api',
        })
      : stageAndScanThirdPartyCapability({
          capabilityType: input.capabilityType,
          capabilityName: input.capabilityName,
          sourceUrl: input.sourceUrl,
          source: input.source || 'memory-v2-capability-lab-api',
          files,
        });
    const memorySummary = summarizeNewMemoryV2CapabilityEvents();
    const improvements = generateMemoryV2ImprovementCandidates();
    return NextResponse.json({
      importId: result.importId,
      rootPath: result.rootPath,
      writtenFiles: result.writtenFiles,
      sourceUrl: 'sourceUrl' in result ? result.sourceUrl : input.sourceUrl || '',
      fetchedUrl: 'fetchedUrl' in result ? result.fetchedUrl : '',
      downloadKind: 'downloadKind' in result ? result.downloadKind : '',
      scan: serializeScan(result.scan),
      memorySummary: {
        scanned: memorySummary.scanned,
        created: memorySummary.created.length,
        maxRowId: memorySummary.maxRowId,
      },
      improvementsCreated: improvements.created.length,
      installState: 'not_installed',
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stage capability reference';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
