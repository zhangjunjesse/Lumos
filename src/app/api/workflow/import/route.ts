import { NextResponse } from 'next/server';
import { createWorkflow } from '@/lib/db/workflows';
import { isBlankWorkflowDraft, validateAnyWorkflowDsl } from '@/lib/workflow/dsl';
import {
  importWorkflowPackage,
  isValidWorkflowPackage,
  type WorkflowPackage,
} from '@/lib/workflow/package';

/**
 * POST /api/workflow/import
 *
 * Import a workflow from a portable JSON package.
 * Creates agent presets (with name-conflict handling) and a new workflow.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!isValidWorkflowPackage(body)) {
      return NextResponse.json(
        { error: '无效的工作流包格式，请检查文件是否正确' },
        { status: 400 },
      );
    }

    const pkg = body as WorkflowPackage;
    const { dsl, createdPresets } = importWorkflowPackage(pkg);

    // Validate the rewritten DSL
    const isBlank = isBlankWorkflowDraft(dsl);
    if (!isBlank) {
      const validation = validateAnyWorkflowDsl(dsl);
      if (!validation.valid) {
        return NextResponse.json(
          { error: `工作流校验失败: ${validation.errors[0] ?? 'DSL 格式无效'}` },
          { status: 400 },
        );
      }
    }

    const name = dsl.name || '导入的工作流';
    const description = 'description' in dsl ? (dsl.description ?? '') : '';

    const workflow = createWorkflow({
      name,
      description,
      workflowDsl: dsl as Parameters<typeof createWorkflow>[0]['workflowDsl'],
      createdBy: 'import',
    });

    return NextResponse.json({ workflow, createdPresets }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '导入失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
