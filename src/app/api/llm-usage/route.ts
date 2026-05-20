import { NextRequest, NextResponse } from 'next/server';
import { listLlmRequestLogs } from '@/lib/llm-request-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const wh = Number(request.nextUrl.searchParams.get('windowHours') || '');
    const { rows, summary } = listLlmRequestLogs({
      windowHours: Number.isFinite(wh) && wh > 0 ? wh : 24,
      limit: 60,
    });
    const total = summary.reduce(
      (a, s) => ({
        input: a.input + (s.input_tokens || 0),
        output: a.output + (s.output_tokens || 0),
        total: a.total + (s.total_tokens || 0),
        calls: a.calls + (s.count || 0),
      }),
      { input: 0, output: 0, total: 0, calls: 0 },
    );
    return NextResponse.json({ total, summary, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load llm usage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
