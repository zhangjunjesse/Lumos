import { NextRequest, NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import {
  listFollowups,
} from '@/lib/ecommerce-assistant/listing-followup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const followups = listFollowups(store, { draft_id: id });
    return NextResponse.json({ followups });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
