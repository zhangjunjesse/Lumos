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

const patchStorySchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  storyText: z.string().trim().min(1).max(2000).optional(),
  actor: z.string().trim().max(120).nullable().optional(),
  goal: z.string().trim().max(500).nullable().optional(),
  benefit: z.string().trim().max(500).nullable().optional(),
  status: storyStatusSchema.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  relatedPages: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  relatedCollections: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; storyId: string }> },
): Promise<NextResponse> {
  try {
    const { id, storyId } = await context.params;
    const input = patchStorySchema.parse(await req.json().catch(() => ({})));
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const story = store.updateStory(id, storyId, input);
    if (!story) {
      return NextResponse.json({ error: 'Story not found' }, { status: 404 });
    }
    return NextResponse.json({ story });
  } catch (err) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; storyId: string }> },
): Promise<NextResponse> {
  try {
    const { id, storyId } = await context.params;
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const deleted = store.deleteStory(id, storyId);
    if (!deleted) {
      return NextResponse.json({ error: 'Story not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
