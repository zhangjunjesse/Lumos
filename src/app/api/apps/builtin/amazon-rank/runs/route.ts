import { NextRequest, NextResponse } from 'next/server';

import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import { parseAsinsText, parseKeywordsText } from '@/lib/amazon-rank/input-parser';
import { getActiveRunId, startRankRun, RankRunBusyError } from '@/lib/amazon-rank/run-manager';
import { listRuns } from '@/lib/amazon-rank/store';
import { resolveBrowserBridgeRuntimeConfig } from '@/lib/browser-runtime/bridge-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = getAmazonRankAppContext();
    return NextResponse.json({ runs: listRuns(ctx.store, 30), activeRunId: getActiveRunId() });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = getAmazonRankAppContext();
    const body = (await req.json().catch(() => null)) as
      | { keywords?: unknown; asins?: unknown }
      | null;

    const keywords = parseKeywordsText(toLines(body?.keywords)).items;
    const asins = parseAsinsText(toLines(body?.asins)).items;
    if (keywords.length === 0) {
      return NextResponse.json({ error: '没有可查询的关键词' }, { status: 400 });
    }
    if (asins.length === 0) {
      return NextResponse.json({ error: '没有有效的 ASIN（10 位字母数字）' }, { status: 400 });
    }
    if (!resolveBrowserBridgeRuntimeConfig()) {
      return NextResponse.json(
        { error: '浏览器未连接：请确认 Lumos 桌面端已启动' },
        { status: 503 },
      );
    }

    const { run } = startRankRun({ store: ctx.store, source: 'manual', keywords, asins });
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof RankRunBusyError) {
      return NextResponse.json(
        { error: error.message, activeRunId: error.activeRunId },
        { status: 409 },
      );
    }
    return serverError(error);
  }
}

function toLines(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').join('\n');
  }
  return typeof value === 'string' ? value : '';
}

function serverError(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}
