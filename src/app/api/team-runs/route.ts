import { NextRequest, NextResponse } from 'next/server';
import { getTask } from '@/lib/db/tasks';
import { ensureRunScheduled } from '@/lib/team-run/runtime-manager';

interface StartExistingRunRequest {
  taskId?: string;
  runId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as StartExistingRunRequest;
    const requestedRunId = body.runId?.trim()
      || getTask(body.taskId?.trim() || '')?.current_run_id?.trim()
      || '';

    if (!requestedRunId) {
      return NextResponse.json(
        {
          error: 'Creating ad-hoc team runs is no longer supported. Approve a team task or provide an existing runId.',
        },
        { status: 400 },
      );
    }

    ensureRunScheduled(requestedRunId);
    return NextResponse.json({ success: true, runId: requestedRunId });
  } catch (error) {
    console.error('Start existing team run error:', error);
    return NextResponse.json(
      { error: 'Failed to start team run' },
      { status: 500 },
    );
  }
}
