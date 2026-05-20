import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDigestPrompt, setDigestPrompt } from '@/lib/memory-v2/digest-prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const putSchema = z.object({
  prompt: z.string().max(8000),
});

export async function GET() {
  try {
    return NextResponse.json(getDigestPrompt());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load digest prompt';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = putSchema.parse(body);
    return NextResponse.json(setDigestPrompt(input.prompt));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save digest prompt';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
