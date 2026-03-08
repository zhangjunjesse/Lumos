import { NextRequest, NextResponse } from 'next/server';
import {
  deleteMemory,
  setMemoryArchived,
  setMemoryPinned,
  updateMemory,
  updateMemoryContent,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ok(changed: boolean, notFoundMessage: string) {
  if (!changed) {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const action = String(body?.action || '').trim();

    if (!id) {
      return NextResponse.json({ error: 'Memory id is required' }, { status: 400 });
    }

    switch (action) {
      case 'pin':
        return ok(setMemoryPinned(id, true), 'Memory not found');
      case 'unpin':
        return ok(setMemoryPinned(id, false), 'Memory not found');
      case 'archive':
        return ok(setMemoryArchived(id, true), 'Memory not found');
      case 'restore':
        return ok(setMemoryArchived(id, false), 'Memory not found');
      case 'update': {
        const contentRaw = body?.content;
        const scopeRaw = body?.scope;
        const categoryRaw = body?.category;
        const tagsRaw = body?.tags;
        const projectPathRaw = body?.projectPath;

        const payload: {
          content?: string;
          scope?: 'global' | 'project' | 'session';
          category?: 'preference' | 'constraint' | 'fact' | 'workflow' | 'other';
          tags?: string[];
          projectPath?: string;
        } = {};

        if (typeof contentRaw === 'string') payload.content = contentRaw;
        if (scopeRaw === 'global' || scopeRaw === 'project' || scopeRaw === 'session') payload.scope = scopeRaw;
        if (categoryRaw === 'preference' || categoryRaw === 'constraint' || categoryRaw === 'fact' || categoryRaw === 'workflow' || categoryRaw === 'other') {
          payload.category = categoryRaw;
        }
        if (typeof projectPathRaw === 'string') payload.projectPath = projectPathRaw;
        if (Array.isArray(tagsRaw)) {
          payload.tags = tagsRaw.map((item) => String(item));
        } else if (typeof tagsRaw === 'string') {
          payload.tags = tagsRaw
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean);
        }

        if (Object.keys(payload).length === 0) {
          return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        // Backward compatibility: when only content is provided, keep old helper behavior.
        if (
          payload.content !== undefined
          && payload.scope === undefined
          && payload.category === undefined
          && payload.tags === undefined
          && payload.projectPath === undefined
        ) {
          const changed = updateMemoryContent(id, payload.content);
          if (!changed) {
            // updateMemoryContent returns false for not found.
            return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
          }
          return NextResponse.json({ success: true, changed: true });
        }

        const result = updateMemory(id, payload);
        if (!result.exists) {
          return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
        }
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ success: true, changed: result.changed });
      }
      default:
        return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update memory';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Memory id is required' }, { status: 400 });
    }
    return ok(deleteMemory(id), 'Memory not found');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete memory';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
