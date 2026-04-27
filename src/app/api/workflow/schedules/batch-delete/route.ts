import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { deleteScheduledWorkflow } from '@/lib/db/scheduled-workflows';
import { cancelRunningScheduleRuns } from '@/lib/workflow/schedule-run-control';

const schema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
});

interface BatchDeleteResult {
  id: string;
  deleted: boolean;
  cancelledRuns: number;
  error?: string;
}

/**
 * Batch-delete a set of scheduled workflows. Mirrors single DELETE semantics:
 * for each id we first cancel any in-flight runs, then drop the schedule row.
 * One bad id (already deleted, db error) does not abort the whole batch — we
 * collect a per-id result so the UI can report partial success.
 */
export async function POST(request: NextRequest) {
  let parsed: { ids: string[] };
  try {
    parsed = schema.parse(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Dedupe to avoid double-cancelling the same schedule when the client sends
  // duplicates (e.g. select-all over a filtered list).
  const uniqueIds = Array.from(new Set(parsed.ids));
  const results: BatchDeleteResult[] = [];

  for (const id of uniqueIds) {
    try {
      const cancel = await cancelRunningScheduleRuns(id, '批量删除任务，停止执行中的工作流', {
        updateScheduleSummary: false,
      });
      const deleted = deleteScheduledWorkflow(id);
      results.push({
        id,
        deleted,
        cancelledRuns: cancel.cancelledRuns.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ id, deleted: false, cancelledRuns: 0, error: message });
    }
  }

  const summary = {
    total: results.length,
    deleted: results.filter((r) => r.deleted).length,
    failed: results.filter((r) => !r.deleted).length,
    cancelledRuns: results.reduce((sum, r) => sum + r.cancelledRuns, 0),
  };

  return NextResponse.json({ success: true, summary, results });
}
