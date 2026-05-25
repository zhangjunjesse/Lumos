import { NextRequest, NextResponse } from 'next/server';

import {
  startCollectJob,
  type StartCollectKind,
} from '@/lib/douyin-collector/start-collect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: readonly StartCollectKind[] = ['keyword', 'creator', 'link'];

/**
 * Start a collect job from a RAW input (keyword string / profile link /
 * video link) and return immediately with the job id. The pipeline runs
 * in the background; the AI polls GET /jobs/[id] (douyin_job_status) for
 * live progress. This is the progress-visible counterpart to the
 * synchronous douyin_search_keyword.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      kind?: unknown;
      input?: unknown;
      nickname?: unknown;
      cadence?: unknown;
      time_window?: unknown;
      dedupe_window_days?: unknown;
      auto_process?: unknown;
      publish_to_knowledge?: unknown;
      creator_collect_mode?: unknown;
      max_videos?: unknown;
    };
    const kind = typeof body.kind === 'string' ? body.kind : '';
    if (!(KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json(
        { error: 'kind 必须是 keyword / creator / link。' },
        { status: 400 },
      );
    }
    const result = await startCollectJob({
      kind: kind as StartCollectKind,
      input: typeof body.input === 'string' ? body.input : '',
      nickname: typeof body.nickname === 'string' ? body.nickname : undefined,
      cadence: typeof body.cadence === 'string' ? body.cadence : undefined,
      timeWindow: typeof body.time_window === 'string' ? body.time_window : undefined,
      dedupeWindowDays:
        typeof body.dedupe_window_days === 'number' ? body.dedupe_window_days : undefined,
      // 缺省 true：异步入口默认跑完整链路，对齐同步 douyin_search_keyword。
      autoProcess: body.auto_process !== false,
      publishToKnowledge: body.publish_to_knowledge !== false,
      creatorCollectMode:
        body.creator_collect_mode === 'full' || body.creator_collect_mode === 'recent'
          ? body.creator_collect_mode
          : undefined,
      maxVideos:
        typeof body.max_videos === 'number' && Number.isFinite(body.max_videos) && body.max_videos > 0
          ? Math.min(Math.floor(body.max_videos), 500)
          : undefined,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, phase: result.phase },
        { status: 400 },
      );
    }
    return NextResponse.json({ job: result.job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
