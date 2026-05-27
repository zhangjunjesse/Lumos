import { NextResponse } from 'next/server';
import { loadCurrentSignals, refreshWeeklySignals } from '@/lib/etsy-forge/trend-signals';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: 立即跑一次趋势数据刷新（同步对应自动化 native_action）。 */
export async function POST() {
  try {
    const store = getEtsyForgeStore();
    const result = await refreshWeeklySignals(store);
    return NextResponse.json({
      ok: result.ok,
      reason: result.reason,
      current: loadCurrentSignals(store),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** GET: 查当前趋势数据 + 新鲜度。 */
export async function GET() {
  try {
    const store = getEtsyForgeStore();
    return NextResponse.json({ current: loadCurrentSignals(store) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
