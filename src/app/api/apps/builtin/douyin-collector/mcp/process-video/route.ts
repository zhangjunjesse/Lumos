import { NextRequest, NextResponse } from 'next/server';

import { processVideoForAi } from '@/lib/douyin-collector/ai-tools';
import type { TranscribePrefer } from '@/lib/douyin-collector/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREFER = ['native-only', 'allow-asr', 'force-local-asr'] as const;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    video_id?: string;
    aweme_id?: string;
    input?: string;
    transcribe?: boolean;
    summarize?: boolean;
    publish_to_knowledge?: boolean;
    force_transcribe?: boolean;
    prefer?: string;
  };
  const prefer = (PREFER as readonly string[]).includes(body.prefer ?? '')
    ? (body.prefer as TranscribePrefer)
    : undefined;
  const result = await processVideoForAi({
    videoId: body.video_id,
    awemeId: body.aweme_id,
    input: body.input,
    transcribe: body.transcribe,
    summarize: body.summarize,
    publishToKnowledge: body.publish_to_knowledge ?? true,
    forceTranscribe: body.force_transcribe,
    prefer,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
