import { NextRequest, NextResponse } from 'next/server';

import { transcribeVideoFromNative } from '@/lib/douyin-collector/transcribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // ?force=1 (or body { force: true }) bypasses the success-cache and
    // forces a fresh transcribe run. Default is idempotent — clicks on an
    // already-transcribed video return the cached transcript without
    // re-charging the user for ASR.
    const forceQuery = req.nextUrl.searchParams.get('force');
    const force = forceQuery === '1' || forceQuery === 'true';
    const result = await transcribeVideoFromNative(id, { force });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.reason },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      transcriptId: result.transcriptId,
      sourceFormat: result.sourceFormat,
      segmentCount: result.segments.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
