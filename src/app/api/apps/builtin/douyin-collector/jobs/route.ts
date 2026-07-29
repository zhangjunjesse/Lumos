import { NextRequest, NextResponse } from 'next/server';

import { listJobs } from '@/lib/douyin-collector/storage';
import { createJob, findActiveDuplicateJob, runJob } from '@/lib/douyin-collector/jobs';
import { JOB_KINDS } from '@/lib/douyin-collector/constants';
import { parseDouyinInput } from '@/lib/douyin-collector/parse-input';
import { describeUnsupportedInput } from '@/lib/douyin-collector/input-diagnosis';
import type { CreatorCollectMode, JobKind } from '@/lib/douyin-collector/types';

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
      creator_collect_mode?: unknown;
      max_videos?: unknown;
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
      // 短链放行:它的内容类型要展开才知道,真不支持时后面的采集阶段会报准确原因。
      if (parsed.kind !== 'aweme' && parsed.kind !== 'short-url') {
        const diagnosis = describeUnsupportedInput(parsed);
        return NextResponse.json(
          { error: diagnosis.message, reason: diagnosis.reason, type: diagnosis.type },
          { status: 400 },
        );
      }
    }

    const creatorCollectMode =
      body.creator_collect_mode === 'full' || body.creator_collect_mode === 'recent'
        ? body.creator_collect_mode as CreatorCollectMode
        : undefined;
    const maxVideos =
      typeof body.max_videos === 'number' && Number.isFinite(body.max_videos) && body.max_videos > 0
        ? Math.min(Math.floor(body.max_videos), 500)
        : undefined;

    // UI「采集」按钮的天然语义 = 完整管线：元数据→字幕→入库。默认
    // publishToKnowledge=true、autoProcess=true，与 jobs/start 路由对齐，
    // 避免出现「成功 38 / 转写 0」的体验——历史上漏传这两个字段，遇到
    // dedupe + 旧条目时 shouldProcessVideoForJob 会 false，pipeline 整段
    // 不跑也不报错。
    const jobInput = {
      kind: kind as JobKind,
      targetRef,
      autoProcess: true,
      publishToKnowledge: true,
      ...(kind === 'creator' && creatorCollectMode ? { creatorCollectMode } : {}),
      ...(kind === 'creator' && maxVideos ? { maxVideos } : {}),
    };
    const duplicate = findActiveDuplicateJob(jobInput);
    if (duplicate) {
      return NextResponse.json({ job: duplicate, deduped: true });
    }

    const job = createJob(jobInput);

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
