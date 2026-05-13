import { NextRequest, NextResponse } from 'next/server';

import { batchCollectForAi } from '@/lib/douyin-collector/ai-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    creators?: unknown;
    keywords?: unknown;
    links?: unknown;
    limit_per_source?: number;
    auto_process?: boolean;
    publish_to_knowledge?: boolean;
  };
  const result = await batchCollectForAi({
    creators: normalizeStringArray(body.creators),
    keywords: normalizeStringArray(body.keywords),
    links: normalizeStringArray(body.links),
    limitPerSource: body.limit_per_source,
    autoProcess: body.auto_process ?? false,
    publishToKnowledge: body.publish_to_knowledge ?? true,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
