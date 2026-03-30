import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getAgentPreset, updateAgentPreset, deleteAgentPreset } from '@/lib/db/agent-presets';

const toolPermissionsSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  exec: z.boolean(),
});

const updateAgentPresetSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  roleKind: z.enum(['orchestrator', 'lead', 'worker']).optional(),
  responsibility: z.string().trim().min(1).max(500).optional(),
  systemPrompt: z.string().trim().min(1).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  collaborationStyle: z.string().trim().max(500).optional().nullable(),
  outputContract: z.string().trim().max(500).optional().nullable(),
  preferredModel: z.string().trim().optional().nullable(),
  mcpServers: z.array(z.string()).optional().nullable(),
  toolPermissions: toolPermissionsSchema.optional().nullable(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const preset = getAgentPreset(id);
    if (!preset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ preset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get agent preset';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const raw = updateAgentPresetSchema.parse(body);

    // Convert null to undefined for optional fields
    const input = {
      ...raw,
      description: raw.description ?? undefined,
      collaborationStyle: raw.collaborationStyle ?? undefined,
      outputContract: raw.outputContract ?? undefined,
      preferredModel: raw.preferredModel ?? undefined,
      mcpServers: raw.mcpServers ?? undefined,
      toolPermissions: raw.toolPermissions ?? undefined,
    };

    const preset = updateAgentPreset(id, input);
    if (!preset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ preset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update agent preset';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = deleteAgentPreset(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete agent preset';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
