import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  isWorkflowConfigurableAgentRole,
  resetWorkflowAgentRoleProfile,
  updateWorkflowAgentRoleProfile,
} from '@/lib/workflow/agent-config';

const updateWorkflowAgentRoleRequestSchema = z.object({
  systemPrompt: z.string().trim().min(1).optional(),
  allowedTools: z.array(z.enum(['workspace.read', 'workspace.write', 'shell.exec'])).optional(),
  concurrencyLimit: z.number().int().min(1).max(10).optional(),
  plannerTimeoutMs: z.number().int().min(5_000).max(120_000).optional(),
  plannerMaxRetries: z.number().int().min(0).max(5).optional(),
}).strict();

interface WorkflowAgentRoleRouteContext {
  params: Promise<{ roleId: string }>;
}

export async function PUT(
  request: NextRequest,
  context: WorkflowAgentRoleRouteContext,
) {
  try {
    const { roleId } = await context.params;
    if (!isWorkflowConfigurableAgentRole(roleId)) {
      return NextResponse.json({ error: 'Unknown workflow agent role' }, { status: 404 });
    }

    const body = await request.json();
    const input = updateWorkflowAgentRoleRequestSchema.parse(body);
    const role = updateWorkflowAgentRoleProfile(roleId, input);
    return NextResponse.json({ role });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update workflow agent role';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: WorkflowAgentRoleRouteContext,
) {
  try {
    const { roleId } = await context.params;
    if (!isWorkflowConfigurableAgentRole(roleId)) {
      return NextResponse.json({ error: 'Unknown workflow agent role' }, { status: 404 });
    }

    const role = resetWorkflowAgentRoleProfile(roleId);
    return NextResponse.json({ role });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reset workflow agent role';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
