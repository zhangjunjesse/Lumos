import { NextRequest, NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import { listAuditEvents } from '@/lib/ecommerce-assistant/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const url = new URL(req.url);
    const inputId = url.searchParams.get('input_id') || undefined;
    const targetId = url.searchParams.get('target_id') || undefined;
    const limit = url.searchParams.get('limit')
      ? Math.max(1, Math.min(500, Number(url.searchParams.get('limit'))))
      : undefined;
    const events = listAuditEvents(store, { inputId, targetId, limit });
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
