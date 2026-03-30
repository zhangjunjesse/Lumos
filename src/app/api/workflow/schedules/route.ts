import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  listScheduledWorkflows,
  createScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { initScheduler } from '@/lib/scheduler/cron-engine';

// Start the scheduler on the first request to the schedules API
initScheduler();

const workflowDslSchema = z.object({
  version: z.literal('v1'),
  name: z.string(),
  steps: z.array(z.record(z.string(), z.unknown())),
}).passthrough();

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  workflowDsl: workflowDslSchema,
  intervalMinutes: z.number().int().min(1).max(43200),
  workingDirectory: z.string().optional(),
  notifyOnComplete: z.boolean().optional(),
});

export async function GET() {
  try {
    const schedules = listScheduledWorkflows();
    return NextResponse.json({ schedules });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list schedules';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = createSchema.parse(body);
    const schedule = createScheduledWorkflow({
      name: input.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workflowDsl: input.workflowDsl as any,
      intervalMinutes: input.intervalMinutes,
      workingDirectory: input.workingDirectory,
      notifyOnComplete: input.notifyOnComplete,
    });
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create schedule';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
