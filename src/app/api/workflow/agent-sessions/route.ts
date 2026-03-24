import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  cancelWorkflowAgentExecution,
  listActiveWorkflowAgentExecutionSnapshots,
} from '@/lib/workflow/subagent';

const cancelWorkflowAgentSessionSchema = z.object({
  workflowRunId: z.string().trim().min(1),
  stepId: z.string().trim().min(1).optional(),
}).strict();

export async function GET() {
  try {
    const sessions = listActiveWorkflowAgentExecutionSnapshots();
    return NextResponse.json({
      sessions,
      total: sessions.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load workflow agent sessions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = cancelWorkflowAgentSessionSchema.parse(body);
    const cancelled = await cancelWorkflowAgentExecution({
      workflowRunId: input.workflowRunId,
      stepId: input.stepId,
    });

    if (!cancelled) {
      return NextResponse.json({ error: 'Workflow agent session not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      workflowRunId: input.workflowRunId,
      stepId: input.stepId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel workflow agent session';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
