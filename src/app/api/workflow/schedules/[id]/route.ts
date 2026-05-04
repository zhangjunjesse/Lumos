import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  getScheduledWorkflow,
  updateScheduledWorkflow,
  deleteScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';
import { validateBrowserContextId } from '@/lib/browser-provider/context-validation';
import { generateWorkflowFromDsl } from '@/lib/workflow/compiler';
import { cancelRunningScheduleRuns } from '@/lib/workflow/schedule-run-control';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  runMode: z.enum(['scheduled', 'once']).optional(),
  intervalMinutes: z.number().int().min(0).max(43200).optional(),
  scheduleTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  workingDirectory: z.string().optional(),
  browserContextId: z.string().optional(),
  enabled: z.boolean().optional(),
  notifyOnComplete: z.boolean().optional(),
  workflowId: z.string().nullable().optional(),
  workflowDsl: z.object({
    version: z.literal('v3'),
    name: z.string(),
    nodes: z.array(z.record(z.string(), z.unknown())),
    edges: z.array(z.record(z.string(), z.unknown())),
  }).passthrough().optional(),
  runParams: z.record(z.string(), z.unknown()).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const schedule = getScheduledWorkflow(id);
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ schedule });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get schedule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const input = updateSchema.parse(body);
    const existing = getScheduledWorkflow(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // #7: Validate DSL at save time when it changes
    if (input.workflowDsl) {
      const dslValidation = generateWorkflowFromDsl(input.workflowDsl as unknown as Parameters<typeof generateWorkflowFromDsl>[0]);
      if (!dslValidation.validation.valid) {
        return NextResponse.json(
          { error: `工作流 DSL 校验失��: ${dslValidation.validation.errors.join('; ')}` },
          { status: 400 },
        );
      }
    }

    const browserContextId = input.browserContextId !== undefined
      ? validateBrowserContextId(input.browserContextId)
      : undefined;

    const schedule = updateScheduledWorkflow(id, {
      name: input.name,
      runMode: input.runMode,
      intervalMinutes: input.intervalMinutes,
      scheduleTime: input.scheduleTime,
      scheduleDayOfWeek: input.scheduleDayOfWeek,
      workingDirectory: input.workingDirectory,
      browserContextId,
      enabled: input.enabled,
      notifyOnComplete: input.notifyOnComplete,
      workflowId: input.workflowId,
      workflowDsl: input.workflowDsl as Parameters<typeof updateScheduledWorkflow>[1]['workflowDsl'],
      runParams: input.runParams,
    });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const cancelResult = existing.enabled && input.enabled === false
      ? await cancelRunningScheduleRuns(id, '任务已关闭，停止执行中的工作流')
      : undefined;
    return NextResponse.json({ schedule, ...(cancelResult ? { cancelResult } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update schedule';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    await cancelRunningScheduleRuns(id, '任务已删除，停止执行中的工作流', {
      updateScheduleSummary: false,
    });
    const deleted = deleteScheduledWorkflow(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete schedule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
