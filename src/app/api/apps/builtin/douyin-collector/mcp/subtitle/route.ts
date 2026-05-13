import { NextRequest, NextResponse } from 'next/server';

import { processVideoForAi } from '@/lib/douyin-collector/ai-tools';
import type { TranscribePrefer } from '@/lib/douyin-collector/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREFER = ['native-only', 'allow-asr', 'force-local-asr'] as const;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    aweme_id?: string;
    prefer?: string;
  };
  const awemeId = typeof body.aweme_id === 'string' ? body.aweme_id.trim() : '';
  if (!awemeId) {
    return NextResponse.json({ error: 'aweme_id 不能为空。' }, { status: 400 });
  }
  const prefer = (PREFER as readonly string[]).includes(body.prefer ?? '')
    ? (body.prefer as TranscribePrefer)
    : 'allow-asr';

  const result = await processVideoForAi({
    awemeId,
    transcribe: true,
    summarize: false,
    publishToKnowledge: false,
    prefer,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        phase: result.phase ?? 'transcribe_failed',
        aweme_id: awemeId,
        prefer,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    aweme_id: awemeId,
    prefer,
    video: result.video,
    transcribe: result.transcribe,
  });
}
