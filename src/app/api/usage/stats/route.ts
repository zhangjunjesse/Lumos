import { NextRequest } from 'next/server';
import { getTokenUsageStats, type TokenUsageGranularity } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_HOURS_MIN = 1;
const WINDOW_HOURS_MAX = 24 * 365;

function parseGranularity(raw: string | null, fallback: TokenUsageGranularity): TokenUsageGranularity {
  if (raw === 'minute' || raw === 'hour' || raw === 'day') return raw;
  return fallback;
}

function autoGranularity(windowHours: number): TokenUsageGranularity {
  if (windowHours <= 1) return 'minute';
  if (windowHours <= 24) return 'hour';
  return 'day';
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    // 兼容老参数 `days`,新参数 `window_hours` 优先
    let windowHours: number;
    const windowParam = params.get('window_hours');
    if (windowParam) {
      const parsed = parseInt(windowParam, 10);
      windowHours = Number.isFinite(parsed) ? parsed : 24 * 30;
    } else {
      const daysParam = params.get('days');
      const days = daysParam ? parseInt(daysParam, 10) || 30 : 30;
      windowHours = days * 24;
    }
    windowHours = Math.min(Math.max(windowHours, WINDOW_HOURS_MIN), WINDOW_HOURS_MAX);

    const granularity = parseGranularity(params.get('granularity'), autoGranularity(windowHours));

    const stats = getTokenUsageStats({ windowHours, granularity });
    return Response.json({ ...stats, window_hours: windowHours, granularity });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch usage stats';
    return Response.json({ error: message }, { status: 500 });
  }
}
