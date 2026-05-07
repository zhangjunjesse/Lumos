import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { buildWeChatAssistantAnalysis } from '@/lib/wechat-assistant/analysis';
import { normalizeSnapshot, type SnapshotApiResponse } from '@/lib/wechat-assistant/snapshot-normalizer';
import { updateWeChatAssistantTask } from '@/lib/wechat-assistant/tasks';
import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { hasRecoveredKey } from '@/lib/wechat-export/setup-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  sessionLimit: z.number().int().min(1).max(1000).optional(),
  perSessionLimit: z.number().int().min(1).max(2000).optional(),
  maxMessages: z.number().int().min(100).max(200000).optional(),
});

export async function POST(req: NextRequest) {
  if (process.platform !== 'darwin') {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }
  if (!hasValidConsent()) {
    return NextResponse.json({ error: 'consent_required' }, { status: 400 });
  }
  if (!hasRecoveredKey()) {
    return NextResponse.json({ error: 'no_key' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const snapshotResult = await queryWeChatApi<SnapshotApiResponse>('analyze_snapshot', {
    session_limit: parsed.data.sessionLimit ?? 0,
    per_session_limit: parsed.data.perSessionLimit ?? 0,
    max_messages: parsed.data.maxMessages ?? 50000,
  }, {
    timeoutMs: 120_000,
  });
  if (!snapshotResult.ok) {
    return NextResponse.json({
      error: snapshotResult.error.code,
      message: snapshotResult.error.message,
    }, { status: 500 });
  }

  const snapshot = normalizeSnapshot(snapshotResult.data);
  const analysis = buildWeChatAssistantAnalysis(snapshot);
  updateWeChatAssistantTask('daily-summary', {
    lastRunAt: analysis.generatedAt,
    lastResult: analysis.summary,
  });
  return NextResponse.json({ analysis });
}

