import { NextResponse } from 'next/server';

import {
  patrolEnabledCreators,
  patrolEnabledKeywords,
} from '@/lib/douyin-collector/patrol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual "run all patrols now" trigger. Same code path as the scheduled
 * automation runner — fires creators + keywords concurrently. Returns
 * the combined report so the UI can show success/failure counts inline.
 *
 * Honest contract:
 *   - Respects existing cadence gate. If a creator was checked 5 min ago
 *     and has cadence='hourly', it gets skipped — see PatrolReport
 *     "已跳过：cadence 间隔" message.
 *   - The fatal-reason short-circuit (Round 78) still applies: if cookie
 *     fails on creator A, creators B/C don't waste calls.
 *   - Cookie pre-probe (Round 87) runs before each report — second call
 *     hits the 1h cooldown and skips so concurrent invocations don't
 *     double-probe iesdouyin.
 *   - Promise.all over creators + keywords because they read from
 *     independent collections; running them serially doubles wall time
 *     for the same work.
 */
export async function POST() {
  try {
    const [creators, keywords] = await Promise.all([
      patrolEnabledCreators(),
      patrolEnabledKeywords(),
    ]);
    return NextResponse.json({ ok: true, creators, keywords });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
