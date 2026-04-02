import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import {
  listWorkflowAgentPresets,
  createWorkflowAgentPreset,
} from '@/lib/db/workflow-agent-presets';

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  expertise: z.string().trim().min(1).max(500),
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

export async function GET() {
  try {
    const presets = listWorkflowAgentPresets();
    return NextResponse.json({ presets });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list workflow agent presets';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = createSchema.parse(body);
    const preset = createWorkflowAgentPreset(input);
    return NextResponse.json({ preset }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create workflow agent preset';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
