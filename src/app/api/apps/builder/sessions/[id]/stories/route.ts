import { z } from 'zod';
import { type NextRequest, NextResponse } from 'next/server';

import { createSessionStore } from '@/lib/app/builder/session';
import { getAppPlatformService } from '@/lib/app/service';

const storyStatusSchema = z.enum([
  'draft',
  'pending_confirmation',
  'confirmed',
  'in_progress',
  'implemented',
  'accepted',
  'deferred',
]);

const createStorySchema = z.object({
  title: z.string().trim().min(1).max(160),
  storyText: z.string().trim().min(1).max(2000),
  actor: z.string().trim().max(120).optional(),
  goal: z.string().trim().max(500).optional(),
  benefit: z.string().trim().max(500).optional(),
  status: storyStatusSchema.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  relatedPages: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  relatedCollections: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ stories: store.listStories(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const input = createStorySchema.parse(await req.json().catch(() => ({})));
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const story = store.createStory(id, input);
    return NextResponse.json({ story }, { status: 201 });
  } catch (err) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
