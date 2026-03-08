import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import { createSession } from '@/lib/db';
import { dataDir } from '@/lib/db/connection';
import { buildExtensionBuilderPrompt } from '@/lib/extensions/extension-builder';

export async function POST() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const prompt = buildExtensionBuilderPrompt(dataDir);
    const session = createSession('Extension Builder', '', prompt, dataDir, 'code');
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create builder session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
