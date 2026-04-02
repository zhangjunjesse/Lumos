import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { listAgentPresets, createAgentPreset } from '@/lib/db/agent-presets';

const toolPermissionsSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  exec: z.boolean(),
});

const createAgentPresetSchema = z.object({
  name: z.string().trim().min(1).max(100),
  roleKind: z.enum(['orchestrator', 'lead', 'worker']).optional(),
  responsibility: z.string().trim().max(500).optional(),
  systemPrompt: z.string().trim().min(1),
  description: z.string().trim().max(500).optional(),
  collaborationStyle: z.string().trim().max(500).optional(),
  outputContract: z.string().trim().max(500).optional(),
  preferredModel: z.string().trim().optional(),
  providerId: z.string().trim().optional(),
  mcpServers: z.array(z.string()).optional(),
  toolPermissions: toolPermissionsSchema.optional(),
  position: z.string().trim().max(100).optional(),
  interests: z.string().trim().max(300).optional(),
  specialties: z.string().trim().max(300).optional(),
  departmentId: z.string().nullable().optional(),
});

export async function GET() {
  try {
    const presets = listAgentPresets();
    return NextResponse.json({ presets });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list agent presets';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = createAgentPresetSchema.parse(body);
    const preset = createAgentPreset(input);
    return NextResponse.json({ preset }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create agent preset';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
