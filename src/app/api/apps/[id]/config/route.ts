import { type NextRequest, NextResponse } from 'next/server';

import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET  /api/apps/<id>/config                  — list keys with metadata only
 *                                                (values for non-secrets are
 *                                                 also returned to the renderer)
 * PUT  /api/apps/<id>/config                  — body: { entries: [{ key, value, secret }] }
 * DELETE /api/apps/<id>/config?key=<k>        — remove a key
 *
 * Secret values are NEVER returned over the wire. The list endpoint includes
 * a `value` field only when isSecret = false.
 */

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { vault } = getAppPlatformService();
    const meta = vault.list(id);
    const entries = meta.map((m) => ({
      key: m.key,
      isSecret: m.isSecret,
      updatedAt: m.updatedAt,
      value: m.isSecret ? null : vault.get(id, m.key),
    }));
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

interface ConfigPutEntry {
  key: string;
  value: string;
  secret?: boolean;
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { vault } = getAppPlatformService();
    const body = (await req.json()) as { entries?: ConfigPutEntry[] };
    if (!Array.isArray(body.entries)) {
      return NextResponse.json({ error: 'Body must include entries: []' }, { status: 400 });
    }
    for (const e of body.entries) {
      if (typeof e.key !== 'string' || typeof e.value !== 'string') {
        return NextResponse.json(
          { error: `Invalid entry: ${JSON.stringify(e)}` },
          { status: 400 },
        );
      }
      vault.set(id, e.key, e.value, { secret: !!e.secret });
    }
    return NextResponse.json({ ok: true, count: body.entries.length });
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
    const key = new URL(req.url).searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'Missing ?key' }, { status: 400 });
    }
    const { vault } = getAppPlatformService();
    const removed = vault.delete(id, key);
    return NextResponse.json({ ok: removed });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
