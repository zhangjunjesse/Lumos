import { z } from 'zod';
import { type NextRequest, NextResponse } from 'next/server';

import {
  APP_BUILDER_MODEL_KEY,
  APP_BUILDER_PROVIDER_KEY,
  APP_BUILDER_SYSTEM_PROMPT_KEY,
  DEFAULT_APP_BUILDER_SYSTEM_PROMPT,
} from '@/lib/app/builder/assistant-config';
import { listAppBuilderProviderModelGroups } from '@/lib/chat/app-builder-session';
import { getSetting, setSetting } from '@/lib/db/sessions';

const updateSchema = z.object({
  providerId: z.string().trim().optional(),
  model: z.string().trim().optional(),
  systemPrompt: z.string().optional(),
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(readConfig());
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const input = updateSchema.parse(await request.json());
    if (typeof input.providerId === 'string') {
      setSetting(APP_BUILDER_PROVIDER_KEY, input.providerId.trim());
    }
    if (typeof input.model === 'string') {
      setSetting(APP_BUILDER_MODEL_KEY, input.model.trim());
    }
    if (typeof input.systemPrompt === 'string') {
      setSetting(APP_BUILDER_SYSTEM_PROMPT_KEY, input.systemPrompt);
    }
    return NextResponse.json(readConfig());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to update app builder config';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function readConfig() {
  const providerModels = listAppBuilderProviderModelGroups();

  return {
    providerId: getSetting(APP_BUILDER_PROVIDER_KEY) || '',
    model: getSetting(APP_BUILDER_MODEL_KEY) || '',
    systemPrompt: getSetting(APP_BUILDER_SYSTEM_PROMPT_KEY) || '',
    defaultSystemPrompt: DEFAULT_APP_BUILDER_SYSTEM_PROMPT,
    providerModels,
  };
}
