import { NextRequest, NextResponse } from 'next/server';

import {
  collectCreatorForAi,
  collectKeywordForAi,
  collectVideoForAi,
} from '@/lib/douyin-collector/ai-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      kind?: string;
      input?: string;
      query?: string;
      limit?: number;
      auto_process?: boolean;
      publish_to_knowledge?: boolean;
      time_window?: string;
      dedupe_window_days?: number;
      nickname?: string;
      cadence?: string;
    };
    const kind = body.kind;
    const input = (body.input ?? body.query ?? '').trim();
    if (!kind || !input) {
      return NextResponse.json(
        { ok: false, error: 'kind 和 input/query 不能为空。' },
        { status: 400 },
      );
    }

    const common = {
      limit: body.limit,
      // 默认开启：采集即处理（抓字幕→总结→入库），与其它采集入口一致。
      // 只想要元数据时显式 auto_process=false。
      autoProcess: body.auto_process ?? true,
      publishToKnowledge: body.publish_to_knowledge ?? true,
    };
    const result =
      kind === 'link' || kind === 'video'
        ? await collectVideoForAi(input, { ...common })
        : kind === 'creator'
          ? await collectCreatorForAi(input, {
              ...common,
              nickname: body.nickname,
              cadence: body.cadence,
            })
          : kind === 'keyword'
            ? await collectKeywordForAi(input, {
                ...common,
                timeWindow: body.time_window,
                dedupeWindowDays: body.dedupe_window_days,
                cadence: body.cadence,
              })
            : { ok: false as const, error: 'kind 必须是 link / video / creator / keyword。' };

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, phase: result.phase ?? 'collect_failed' },
        { status: 400 },
      );
    }
    const failedJob = 'job' in result && result.job?.status === 'failed' ? result.job : null;
    return NextResponse.json(
      {
        ...result,
        ok: failedJob ? false : true,
        error: failedJob?.failure_reason ?? undefined,
        phase: failedJob ? 'collect_failed' : undefined,
      },
      { status: failedJob ? 503 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        phase: 'collect_exception',
        error: `抖音采集服务异常：${message}`,
      },
      { status: 502 },
    );
  }
}
