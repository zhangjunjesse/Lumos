import { NextRequest, NextResponse } from 'next/server';

import {
  getBuiltinAppVisibility,
  setHiddenBuiltinAppIds,
} from '@/lib/builtin-apps-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — return effective visibility per app, including which side hid it
 * (`hiddenByUser` from local Settings, `hiddenByServer` from lumos-web admin).
 * UI uses `hiddenByServer` to lock the toggle and explain the lock.
 *
 * PUT — set the LOCAL hide list only. The server-side hide list is read-only
 * here; admin changes it from lumos-web and the desktop pulls via heartbeat.
 */
export async function GET() {
  try {
    return NextResponse.json({ apps: getBuiltinAppVisibility() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { hidden?: unknown };
    const hiddenInput = Array.isArray(body.hidden) ? body.hidden : [];
    const ids = hiddenInput.filter((v): v is string => typeof v === 'string');
    const accepted = setHiddenBuiltinAppIds(ids);
    return NextResponse.json({ hidden: accepted, apps: getBuiltinAppVisibility() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
