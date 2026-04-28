import { NextRequest, NextResponse } from 'next/server';
import { getWorkflow, listWorkflows } from '@/lib/db/workflows';
import { exportWorkflowBundlePackage } from '@/lib/workflow/package';
import type { AnyWorkflowDSL } from '@/lib/workflow/types';

const MAX_BATCH_SIZE = 200;

interface ExportRequestBody {
  ids?: unknown;
  all?: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ExportRequestBody;
    const exportAll = body.all === true;
    let workflows = exportAll ? listWorkflows() : [];

    if (!exportAll) {
      if (!isStringArray(body.ids)) {
        return NextResponse.json({ error: '请选择要导出的工作流' }, { status: 400 });
      }

      const ids = Array.from(new Set(body.ids.map((id) => id.trim())));
      if (ids.length > MAX_BATCH_SIZE) {
        return NextResponse.json({ error: `单次最多导出 ${MAX_BATCH_SIZE} 个工作流` }, { status: 400 });
      }

      workflows = ids.flatMap((id) => {
        const workflow = getWorkflow(id);
        return workflow ? [workflow] : [];
      });
    }

    if (workflows.length === 0) {
      return NextResponse.json({ error: '没有可导出的工作流' }, { status: 404 });
    }
    if (workflows.length > MAX_BATCH_SIZE) {
      return NextResponse.json({ error: `单次最多导出 ${MAX_BATCH_SIZE} 个工作流` }, { status: 400 });
    }

    const unsupported = workflows.filter((workflow) => {
      const dsl = workflow.workflowDsl as AnyWorkflowDSL;
      return dsl.version !== 'v3';
    });
    if (unsupported.length > 0) {
      return NextResponse.json(
        { error: `以下工作流不是 v3 格式，暂不支持导出：${unsupported.map((workflow) => workflow.name).join('、')}` },
        { status: 400 },
      );
    }

    const bundle = exportWorkflowBundlePackage(workflows.map((workflow) => workflow.workflowDsl));
    return NextResponse.json({
      ...bundle,
      count: bundle.workflows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '批量导出失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
