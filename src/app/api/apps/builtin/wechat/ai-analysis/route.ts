import { NextRequest, NextResponse } from 'next/server';

import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { hasRecoveredKey } from '@/lib/wechat-export/setup-state';

import { getLatestAIAnalysis, runAIAnalysis, WeChatAIAnalysisError } from '@/lib/wechat-assistant/ai-runner';
import { normalizeSnapshot, type SnapshotApiResponse } from '@/lib/wechat-assistant/snapshot-normalizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const latest = getLatestAIAnalysis();
  return NextResponse.json(latest);
}

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

  // Allow body for future tuning (windowDays etc.); ignore parse errors.
  void req.json().catch(() => ({}));

  const snapshotResult = await queryWeChatApi<SnapshotApiResponse>(
    'analyze_snapshot',
    { session_limit: 0, per_session_limit: 0, max_messages: 50000 },
    { timeoutMs: 120_000 },
  );
  if (!snapshotResult.ok) {
    return NextResponse.json(
      { error: snapshotResult.error.code, message: snapshotResult.error.message },
      { status: 500 },
    );
  }

  const snapshot = normalizeSnapshot(snapshotResult.data);

  try {
    const result = await runAIAnalysis(snapshot);
    return NextResponse.json({
      run: result.run,
      events: result.events,
      newSuggestions: result.newSuggestions,
      todos: result.allTodos,
    });
  } catch (err) {
    if (err instanceof WeChatAIAnalysisError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'unexpected', message }, { status: 500 });
  }
}

