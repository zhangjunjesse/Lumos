import { NextRequest, NextResponse } from 'next/server';
import { getWorkflow } from '@/lib/db/workflows';
import { getScheduledWorkflow } from '@/lib/db/scheduled-workflows';
import { exportWorkflowPackage } from '@/lib/workflow/package';
import type { AnyWorkflowDSL } from '@/lib/workflow/types';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/workflow/export/{id}?source=definition|schedule
 *
 * Export a workflow as a portable JSON package.
 * Default source is "definition". Use source=schedule to export from a scheduled workflow.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const source = request.nextUrl.searchParams.get('source') ?? 'definition';
    if (source !== 'definition' && source !== 'schedule') {
      return NextResponse.json({ error: 'source 参数无效，仅支持 definition 或 schedule' }, { status: 400 });
    }

    let dsl: AnyWorkflowDSL | null = null;

    if (source === 'schedule') {
      const schedule = getScheduledWorkflow(id);
      if (!schedule) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
      dsl = schedule.workflowDsl;
    } else {
      const workflow = getWorkflow(id);
      if (!workflow) return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
      dsl = workflow.workflowDsl as AnyWorkflowDSL;
    }

    const pkg = exportWorkflowPackage(dsl);
    return NextResponse.json(pkg);
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
