import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  getScheduledWorkflow,
  updateScheduledWorkflow,
  deleteScheduledWorkflow,
} from '@/lib/db/scheduled-workflows';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  intervalMinutes: z.number().int().min(1).max(43200).optional(),
  workingDirectory: z.string().optional(),
  enabled: z.boolean().optional(),
  notifyOnComplete: z.boolean().optional(),
  workflowDsl: z.object({
    version: z.literal('v1'),
    name: z.string(),
    steps: z.array(z.record(z.string(), z.unknown())),
  }).passthrough().optional(),
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
    const schedule = updateScheduledWorkflow(id, {
      ...input,
      workflowDsl: input.workflowDsl as Parameters<typeof updateScheduledWorkflow>[1]['workflowDsl'],
    });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ schedule });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update schedule';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = deleteScheduledWorkflow(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete schedule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
