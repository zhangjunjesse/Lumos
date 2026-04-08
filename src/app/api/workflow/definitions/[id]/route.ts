import { NextRequest, NextResponse } from 'next/server';
import { getWorkflow, updateWorkflow, deleteWorkflow } from '@/lib/db/workflows';
import { isBlankWorkflowDraft, validateAnyWorkflowDsl } from '@/lib/workflow/dsl';
import type { AnyWorkflowDSL } from '@/lib/workflow/types';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  if (!workflow) {
    return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
  }
  return NextResponse.json({ workflow });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { name, description, tags, groupName, workflowDsl, isTemplate } = body as {
      name?: string;
      description?: string;
      tags?: string[];
      groupName?: string;
      workflowDsl?: unknown;
      isTemplate?: boolean;
    };

    if (name !== undefined && name.length > 200) {
      return NextResponse.json({ error: '名称不能超过 200 字符' }, { status: 400 });
    }
    if (description !== undefined && description.length > 2000) {
      return NextResponse.json({ error: '描述不能超过 2000 字符' }, { status: 400 });
    }
    const isBlankDraft = workflowDsl && typeof workflowDsl === 'object'
      ? isBlankWorkflowDraft(workflowDsl)
      : false;

    console.info('[workflow-definition:update:start]', {
      workflowId: id,
      name,
      isBlankDraft,
      stepCount: Array.isArray((workflowDsl as { steps?: unknown[] } | undefined)?.steps)
        ? ((workflowDsl as { steps?: unknown[] }).steps?.length ?? 0)
        : null,
    });

    const validation = workflowDsl && typeof workflowDsl === 'object' && !isBlankDraft
      ? validateAnyWorkflowDsl(workflowDsl as AnyWorkflowDSL)
      : null;

    if (validation && !validation.valid) {
      console.warn('[workflow-definition:update:validation-failed]', {
        workflowId: id,
        error: validation.errors?.[0] ?? 'DSL 格式无效',
      });
    }

    const updated = updateWorkflow(id, {
      name,
      description,
      tags,
      groupName,
      workflowDsl: workflowDsl as Parameters<typeof updateWorkflow>[1]['workflowDsl'],
      isTemplate,
    });

    if (!updated) {
      console.warn('[workflow-definition:update:not-found]', { workflowId: id });
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    console.info('[workflow-definition:update:success]', {
      workflowId: id,
      stepCount: updated.workflowDsl.steps?.length ?? 0,
      name: updated.name,
      validationValid: validation?.valid ?? true,
    });
    return NextResponse.json({ workflow: updated, validation });
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新失败';
    console.error('[workflow-definition:update:error]', {
      workflowId: id,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deleted = deleteWorkflow(id);
  if (!deleted) {
    return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
