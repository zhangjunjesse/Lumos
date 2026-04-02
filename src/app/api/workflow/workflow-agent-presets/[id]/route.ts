import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  getWorkflowAgentPreset,
  updateWorkflowAgentPreset,
  deleteWorkflowAgentPreset,
} from '@/lib/db/workflow-agent-presets';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  expertise: z.string().trim().min(1).max(500).optional(),
  role: z.enum(['worker', 'researcher', 'coder', 'integration']).optional(),
  systemPrompt: z.string().trim().optional(),
  model: z.string().trim().optional(),
  allowedTools: z.array(z.enum(['workspace.read', 'workspace.write', 'shell.exec'])).optional(),
  outputMode: z.enum(['structured', 'plain-text']).optional(),
  capabilityTags: z.array(z.string()).optional(),
  memoryPolicy: z.string().trim().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const preset = getWorkflowAgentPreset(id);
    if (!preset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ preset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get workflow agent preset';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const input = updateSchema.parse(body);
    const preset = updateWorkflowAgentPreset(id, input);
    return NextResponse.json({ preset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update workflow agent preset';
    const status = error instanceof Error
      ? error.message.includes('not found') ? 404
        : error.message.includes('builtin') ? 403
        : 400
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    deleteWorkflowAgentPreset(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete workflow agent preset';
    const status = error instanceof Error && error.message.includes('builtin') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
