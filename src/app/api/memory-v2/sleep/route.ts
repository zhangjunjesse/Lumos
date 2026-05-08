import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { initScheduler } from '@/lib/scheduler/cron-engine';
import {
  getMemoryV2SleepConfig,
  listMemoryV2SleepRuns,
  runMemoryV2Sleep,
  updateMemoryV2SleepConfig,
} from '@/lib/memory-v2/sleep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

initScheduler();

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  time: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
});

const runSchema = z.object({
  force: z.boolean().optional(),
  trigger: z.enum(['manual', 'daily', 'api']).optional(),
});

function payload(limit = 20) {
  return {
    config: getMemoryV2SleepConfig(),
    runs: listMemoryV2SleepRuns(limit),
  };
}

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') || '');
    return NextResponse.json(payload(Number.isFinite(limit) && limit > 0 ? limit : 20));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Memory v2 sleep status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    updateMemoryV2SleepConfig(updateSchema.parse(body));
    return NextResponse.json(payload());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update Memory v2 sleep config';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = runSchema.parse(body);
    const run = runMemoryV2Sleep({
      trigger: input.trigger || 'manual',
      force: input.force !== false,
    });
    return NextResponse.json({
      ...payload(),
      run,
    }, { status: run.status === 'error' ? 500 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run Memory v2 sleep';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
