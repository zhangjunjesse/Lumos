import { NextRequest, NextResponse } from 'next/server';
import { getWorkflow, updateWorkflow, deleteWorkflow } from '@/lib/db/workflows';
import { validateAnyWorkflowDsl } from '@/lib/workflow/dsl';
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
    const { name, description, tags, workflowDsl, isTemplate } = body as {
      name?: string;
      description?: string;
      tags?: string[];
      workflowDsl?: unknown;
      isTemplate?: boolean;
    };

    if (name !== undefined && name.length > 200) {
      return NextResponse.json({ error: '名称不能超过 200 字符' }, { status: 400 });
    }
    if (description !== undefined && description.length > 2000) {
      return NextResponse.json({ error: '描述不能超过 2000 字符' }, { status: 400 });
    }
    if (workflowDsl && typeof workflowDsl === 'object') {
      const dslValidation = validateAnyWorkflowDsl(workflowDsl as AnyWorkflowDSL);
      if (!dslValidation.valid) {
        return NextResponse.json({ error: dslValidation.errors?.[0] ?? 'DSL 格式无效' }, { status: 400 });
      }
    }

    const updated = updateWorkflow(id, {
      name,
      description,
      tags,
      workflowDsl: workflowDsl as Parameters<typeof updateWorkflow>[1]['workflowDsl'],
      isTemplate,
    });

    if (!updated) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    return NextResponse.json({ workflow: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新失败';
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
