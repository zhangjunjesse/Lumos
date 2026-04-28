import { NextResponse } from 'next/server';
import { createWorkflow } from '@/lib/db/workflows';
import { isBlankWorkflowDraft, validateAnyWorkflowDsl } from '@/lib/workflow/dsl';
import {
  importWorkflowBundlePackage,
  importWorkflowPackage,
  isValidWorkflowBundlePackage,
  isValidWorkflowPackage,
  type WorkflowBundlePackage,
  type WorkflowPackage,
} from '@/lib/workflow/package';
import type { WorkflowDSLV3 } from '@/lib/workflow/types';

const MAX_IMPORT_BATCH_SIZE = 200;

/**
 * POST /api/workflow/import
 *
 * Import a workflow from a portable JSON package.
 * Creates agent presets (with name-conflict handling) and a new workflow.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (isValidWorkflowBundlePackage(body)) {
      const bundle = body as WorkflowBundlePackage;
      if (bundle.workflows.length > MAX_IMPORT_BATCH_SIZE) {
        return NextResponse.json(
          { error: `单次最多导入 ${MAX_IMPORT_BATCH_SIZE} 个工作流` },
          { status: 400 },
        );
      }

      for (const item of bundle.workflows) {
        const validationError = validateImportedDsl(item.workflow);
        if (validationError) {
          return NextResponse.json({ error: validationError }, { status: 400 });
        }
      }

      const { workflows: importedWorkflows, createdPresets } = importWorkflowBundlePackage(bundle);
      const workflows = importedWorkflows.map(({ dsl }) => createImportedWorkflow(dsl));

      return NextResponse.json(
        { workflows, workflow: workflows[0] ?? null, createdPresets, count: workflows.length },
        { status: 201 },
      );
    }

    if (!isValidWorkflowPackage(body)) {
      return NextResponse.json(
        { error: '无效的工作流包格式，请检查文件是否正确' },
        { status: 400 },
      );
    }

    const pkg = body as WorkflowPackage;
    const validationError = validateImportedDsl(pkg.workflow);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { dsl, createdPresets } = importWorkflowPackage(pkg);
    const workflow = createImportedWorkflow(dsl);

    return NextResponse.json({ workflow, workflows: [workflow], createdPresets, count: 1 }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '导入失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function validateImportedDsl(dsl: WorkflowDSLV3): string | null {
  const isBlank = isBlankWorkflowDraft(dsl);
  if (isBlank) {
    return null;
  }

  const validation = validateAnyWorkflowDsl(dsl);
  if (!validation.valid) {
    return `工作流校验失败: ${validation.errors[0] ?? 'DSL 格式无效'}`;
  }

  return null;
}

function createImportedWorkflow(dsl: WorkflowDSLV3) {
  const name = dsl.name || '导入的工作流';
  const description = 'description' in dsl ? (dsl.description ?? '') : '';

  return createWorkflow({
    name,
    description,
    workflowDsl: dsl as Parameters<typeof createWorkflow>[0]['workflowDsl'],
    createdBy: 'import',
  });
}
