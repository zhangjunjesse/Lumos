import { NextRequest, NextResponse } from 'next/server';
import { listWorkflows, createWorkflow } from '@/lib/db/workflows';
import { isBlankWorkflowDraft, validateAnyWorkflowDsl } from '@/lib/workflow/dsl';
import type { AnyWorkflowDSL } from '@/lib/workflow/types';

const MAX_NAME_LEN = 200;
const MAX_DESC_LEN = 2000;
const MAX_TAGS = 50;
const MAX_TAG_LEN = 100;

export async function GET(request: NextRequest) {
  const isTemplate = request.nextUrl.searchParams.get('isTemplate');
  const opts = isTemplate !== null ? { isTemplate: isTemplate === 'true' } : undefined;
  const workflows = listWorkflows(opts);
  return NextResponse.json({ workflows });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, tags, workflowDsl, isTemplate, createdBy } = body as {
      name?: string;
      description?: string;
      tags?: string[];
      workflowDsl?: unknown;
      isTemplate?: boolean;
      createdBy?: string;
    };

    if (!name?.trim()) {
      return NextResponse.json({ error: '名称不能为空' }, { status: 400 });
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json({ error: `名称不能超过 ${MAX_NAME_LEN} 字符` }, { status: 400 });
    }
    if (description && description.length > MAX_DESC_LEN) {
      return NextResponse.json({ error: `描述不能超过 ${MAX_DESC_LEN} 字符` }, { status: 400 });
    }
    if (tags && (tags.length > MAX_TAGS || tags.some(t => typeof t !== 'string' || t.length > MAX_TAG_LEN))) {
      return NextResponse.json({ error: '标签数量或长度超限' }, { status: 400 });
    }
    if (!workflowDsl || typeof workflowDsl !== 'object') {
      return NextResponse.json({ error: '工作流 DSL 不能为空' }, { status: 400 });
    }

    // Skip strict DSL validation for blank workflows (steps empty) — they are
    // saved as drafts and validated only when run.
    const dslObj = workflowDsl as AnyWorkflowDSL;
    const isBlank = isBlankWorkflowDraft(dslObj);
    if (!isBlank) {
      const dslValidation = validateAnyWorkflowDsl(dslObj);
      if (!dslValidation.valid) {
        return NextResponse.json({ error: dslValidation.errors?.[0] ?? '工作流 DSL 格式无效' }, { status: 400 });
      }
    }

    const workflow = createWorkflow({
      name,
      description,
      tags,
      workflowDsl: workflowDsl as Parameters<typeof createWorkflow>[0]['workflowDsl'],
      isTemplate,
      createdBy,
    });

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
