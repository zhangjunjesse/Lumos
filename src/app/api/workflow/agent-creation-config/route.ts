import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db/sessions';

const PROVIDER_KEY = 'agent_creation_provider_id';
const MODEL_KEY = 'agent_creation_model';
const PROMPT_KEY = 'agent_creation_system_prompt';

export async function GET() {
  return NextResponse.json({
    providerId: getSetting(PROVIDER_KEY) || '',
    model: getSetting(MODEL_KEY) || '',
    systemPrompt: getSetting(PROMPT_KEY) || '',
  });
}

const updateSchema = z.object({
  providerId: z.string().trim().optional(),
  model: z.string().trim().optional(),
  systemPrompt: z.string().optional(),
});

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const input = updateSchema.parse(body);
    if (typeof input.providerId === 'string') {
      setSetting(PROVIDER_KEY, input.providerId.trim());
    }
    if (typeof input.model === 'string') {
      setSetting(MODEL_KEY, input.model.trim());
    }
    if (typeof input.systemPrompt === 'string') {
      setSetting(PROMPT_KEY, input.systemPrompt);
    }
    return NextResponse.json({
      providerId: getSetting(PROVIDER_KEY) || '',
      model: getSetting(MODEL_KEY) || '',
      systemPrompt: getSetting(PROMPT_KEY) || '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update agent creation config';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
