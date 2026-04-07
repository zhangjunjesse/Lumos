import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  listScheduledWorkflows,
  createScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { initScheduler } from '@/lib/scheduler/cron-engine';
import { generateWorkflowFromDsl } from '@/lib/workflow/compiler';

// Start the scheduler on the first request to the schedules API
initScheduler();

const workflowDslSchema = z.object({
  version: z.string(),
  name: z.string(),
  steps: z.array(z.record(z.string(), z.unknown())),
}).passthrough();

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  workflowDsl: workflowDslSchema,
  workflowId: z.string().optional(),
  runMode: z.enum(['scheduled', 'once']).optional(),
  intervalMinutes: z.number().int().min(0).max(43200),
  scheduleTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  workingDirectory: z.string().optional(),
  notifyOnComplete: z.boolean().optional(),
  runParams: z.record(z.string(), z.unknown()).optional(),
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

    // #7: Validate DSL at save time instead of only at execution time
    const dslValidation = generateWorkflowFromDsl(input.workflowDsl as unknown as Parameters<typeof generateWorkflowFromDsl>[0]);
    if (!dslValidation.validation.valid) {
      return NextResponse.json(
        { error: `工作流 DSL 校验失败: ${dslValidation.validation.errors.join('; ')}` },
        { status: 400 },
      );
    }

    const schedule = createScheduledWorkflow({
      name: input.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workflowDsl: input.workflowDsl as any,
      workflowId: input.workflowId,
      runMode: input.runMode,
      intervalMinutes: input.intervalMinutes || 60,
      scheduleTime: input.scheduleTime,
      scheduleDayOfWeek: input.scheduleDayOfWeek,
      workingDirectory: input.workingDirectory,
      notifyOnComplete: input.notifyOnComplete,
      runParams: input.runParams,
    });
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create schedule';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
