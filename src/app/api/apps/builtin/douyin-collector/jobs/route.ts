import { NextRequest, NextResponse } from 'next/server';

import { listJobs } from '@/lib/douyin-collector/storage';
import { createJob, runJob } from '@/lib/douyin-collector/jobs';
import { JOB_KINDS } from '@/lib/douyin-collector/constants';
import { parseDouyinInput } from '@/lib/douyin-collector/parse-input';
import type { JobKind } from '@/lib/douyin-collector/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ items: listJobs() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      kind?: unknown;
      target_ref?: unknown;
    };
    const kind = typeof body.kind === 'string' ? body.kind : '';
    const targetRef = typeof body.target_ref === 'string' ? body.target_ref.trim() : '';
    if (!(JOB_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: 'kind 取值非法。' }, { status: 400 });
    }
    if (!targetRef) {
      return NextResponse.json({ error: 'target_ref 不能为空。' }, { status: 400 });
    }
    if (kind === 'link') {
      const parsed = parseDouyinInput(targetRef);
      if (parsed.kind !== 'video-url' && parsed.kind !== 'aweme_id' && parsed.kind !== 'short-url') {
        return NextResponse.json(
          { error: '需要抖音视频链接或 aweme id。' },
          { status: 400 },
        );
      }
    }

    const job = createJob({ kind: kind as JobKind, targetRef });

    // Run inline; current implementation closes the job immediately with a
    // structured "not_connected" reason until the MCP bridge ships.
    void runJob(job.id);

    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
