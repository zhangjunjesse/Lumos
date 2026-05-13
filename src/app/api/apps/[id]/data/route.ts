import { type NextRequest, NextResponse } from 'next/server';

import { ensureGoofishDefaultAutomations } from '@/lib/app/goofish-default-automations';
import { createAppDataStore } from '@/lib/app/runtime/data-store';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET    /api/apps/<id>/data?collection=<c>           — list rows
 * GET    /api/apps/<id>/data?collection=<c>&id=<row>  — get single row
 * POST   /api/apps/<id>/data?collection=<c>           — create row
 * PATCH  /api/apps/<id>/data?collection=<c>&id=<row>  — update row
 * DELETE /api/apps/<id>/data?collection=<c>&id=<row>  — delete row
 *
 * Every operation is scoped to <id> via createAppDataStore — there is no
 * way for one app to address another's data through this route.
 */

function getStore(appId: string) {
  const svc = getAppPlatformService();
  return createAppDataStore(svc.db, appId);
}

function repairBuiltinCollection(appId: string, collection: string): void {
  if (appId !== 'goofish-assistant' || collection !== 'app_automations') return;
  ensureGoofishDefaultAutomations(getStore(appId));
}

function readCollection(req: NextRequest): { collection: string } | { error: NextResponse } {
  const collection = new URL(req.url).searchParams.get('collection');
  if (!collection) {
    return {
      error: NextResponse.json({ error: 'Missing ?collection' }, { status: 400 }),
    };
  }
  return { collection };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const c = readCollection(req);
    if ('error' in c) return c.error;
    repairBuiltinCollection(id, c.collection);
    const url = new URL(req.url);
    const rowId = url.searchParams.get('id');
    const store = getStore(id);
    if (rowId) {
      return NextResponse.json({ row: store.get(c.collection, rowId) });
    }
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');
    return NextResponse.json({
      rows: store.query(c.collection, {
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    });
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
    const c = readCollection(req);
    if ('error' in c) return c.error;
    const body = (await req.json()) as Record<string, unknown>;
    const row = getStore(id).create(c.collection, body);
    return NextResponse.json({ row });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const c = readCollection(req);
    if ('error' in c) return c.error;
    const rowId = new URL(req.url).searchParams.get('id');
    if (!rowId) {
      return NextResponse.json({ error: 'Missing ?id' }, { status: 400 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const row = getStore(id).update(c.collection, rowId, body);
    if (!row) return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    return NextResponse.json({ row });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const c = readCollection(req);
    if ('error' in c) return c.error;
    const rowId = new URL(req.url).searchParams.get('id');
    if (!rowId) {
      return NextResponse.json({ error: 'Missing ?id' }, { status: 400 });
    }
    const ok = getStore(id).delete(c.collection, rowId);
    if (!ok) return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
