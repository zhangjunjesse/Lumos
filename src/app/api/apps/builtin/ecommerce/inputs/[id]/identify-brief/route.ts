import { NextResponse } from 'next/server';

import { getEcommerceStore } from '@/lib/ecommerce-assistant/storage';
import {
  identifyBriefForInput,
  BriefIdentifyError,
} from '@/lib/ecommerce-assistant/brief-identifier';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: '缺少输入 id。' }, { status: 400 });
    const store = getEcommerceStore();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    let brief;
    try {
      brief = await identifyBriefForInput(store, id, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
    return NextResponse.json({ brief });
  } catch (err) {
    if (err instanceof BriefIdentifyError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof EcommerceLlmUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
