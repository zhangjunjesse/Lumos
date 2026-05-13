import { NextRequest, NextResponse } from 'next/server';

import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import { COLLECTION_TRANSCRIPTS, COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';
import { normalizeAsrSegmentsForDisplay } from '@/lib/douyin-collector/asr-segments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TranscriptRow {
  id: string;
  video_ref?: string;
  source?: string;
  segments?: string;
  word_count?: number;
  lang?: string;
  updated_at?: string;
}

interface VideoRow {
  duration_seconds?: number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const store = getDouyinCollectorStore();
    const transcripts = store.query<TranscriptRow>(COLLECTION_TRANSCRIPTS, {
      filter: { video_ref: id },
      orderBy: { field: 'updated_at', direction: 'desc' },
      limit: 1,
    });
    const transcript = transcripts[0];
    if (!transcript) {
      return NextResponse.json({ ok: false, error: '该视频还没有 transcript。' }, { status: 404 });
    }
    let segments: Array<{ startSec: number; endSec: number; text: string }> = [];
    try {
      const parsed = JSON.parse(transcript.segments ?? '[]');
      if (Array.isArray(parsed)) {
        segments = parsed.filter(
          (s): s is { startSec: number; endSec: number; text: string } =>
            !!s && typeof s === 'object' && typeof s.text === 'string',
        );
      }
    } catch {
      /* keep [] */
    }
    if (transcript.source === 'asr-local') {
      const video = store.get<VideoRow>(COLLECTION_VIDEOS, id);
      segments = normalizeAsrSegmentsForDisplay(segments, video?.duration_seconds ?? null);
    }
    return NextResponse.json({
      ok: true,
      transcript: {
        id: transcript.id,
        source: transcript.source ?? null,
        lang: transcript.lang ?? null,
        wordCount: transcript.word_count ?? 0,
        segments,
        updatedAt: transcript.updated_at ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
