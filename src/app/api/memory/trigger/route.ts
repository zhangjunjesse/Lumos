import { NextRequest, NextResponse } from 'next/server';
import {
  detectWeakMemorySignal,
  runMemoryIntelligenceForSession,
  type MemoryTriggerReason,
} from '@/lib/memory/intelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TRIGGERS = new Set<MemoryTriggerReason>([
  'idle',
  'session_switch',
  'weak_signal',
  'manual',
  'api',
  'post_reply',
]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = String(body?.sessionId || '').trim();
    const triggerRaw = String(body?.trigger || 'manual').trim() as MemoryTriggerReason;
    const trigger = ALLOWED_TRIGGERS.has(triggerRaw) ? triggerRaw : 'manual';
    const force = body?.force === true;
    const dryRun = body?.dryRun === true;

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    let weakSignal = null as ReturnType<typeof detectWeakMemorySignal> | null;
    if (trigger === 'weak_signal') {
      const text = String(body?.userInput || '').trim();
      weakSignal = detectWeakMemorySignal(text);
      if (!force && !weakSignal.matched) {
        return NextResponse.json({
          result: {
            ok: true,
            trigger,
            outcome: 'skipped',
            reason: 'weak_signal_not_detected',
            candidateCount: 0,
            savedCount: 0,
            tokenEstimate: 0,
            candidates: [],
          },
          weakSignal,
        });
      }
    }

    const result = await runMemoryIntelligenceForSession({
      sessionId,
      trigger,
      force,
      dryRun,
    });

    return NextResponse.json({
      result,
      weakSignal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to trigger memory intelligence';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
