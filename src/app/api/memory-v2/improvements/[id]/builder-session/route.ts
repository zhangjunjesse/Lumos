import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import { createSession, getSession } from '@/lib/db';
import { dataDir } from '@/lib/db/connection';
import { buildExtensionBuilderPrompt } from '@/lib/extensions/extension-builder';
import {
  buildCapabilityBuilderPromptForImprovement,
  getMemoryV2ImprovementCandidate,
  updateMemoryV2ImprovementCandidate,
} from '@/lib/memory-v2/self-improvement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const candidate = getMemoryV2ImprovementCandidate(id);
    if (!candidate) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await fs.mkdir(dataDir, { recursive: true });
    const existingSession = candidate.builder_session_id ? getSession(candidate.builder_session_id) : undefined;
    const session = existingSession ?? createSession(
      `Capability Builder · ${candidate.title}`,
      '',
      buildExtensionBuilderPrompt(dataDir),
      dataDir,
      'code',
    );
    const updated = updateMemoryV2ImprovementCandidate(candidate.id, {
      status: 'building',
      builderSessionId: session.id,
    });
    const prompt = buildCapabilityBuilderPromptForImprovement(updated ?? candidate);

    return NextResponse.json({
      session,
      prompt,
      candidateId: candidate.id,
    }, { status: existingSession ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create builder session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
