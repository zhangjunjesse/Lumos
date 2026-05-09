import { NextRequest, NextResponse } from 'next/server';

import { startJob } from '@/lib/ecommerce-assistant/job-runner';
import {
  getEcommerceStore,
  listJobs,
  listOutputs,
} from '@/lib/ecommerce-assistant/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || undefined;
    const inputId = url.searchParams.get('input_id') || undefined;
    const includeOutputs = url.searchParams.get('outputs') === '1';
    const store = getEcommerceStore();
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (inputId) filter.input_id = inputId;
    const jobs = listJobs(store, filter);
    if (!includeOutputs) return NextResponse.json({ jobs });
    const outputs = listOutputs(store);
    return NextResponse.json({ jobs, outputs });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      input_id?: string;
      preset_id?: string;
      aspect_ratio?: string;
    };
    const inputId = String(body.input_id ?? '').trim();
    if (!inputId) {
      return NextResponse.json({ error: '必须提供 input_id。' }, { status: 400 });
    }
    const job = await startJob({
      inputId,
      presetId: body.preset_id,
      aspectRatio: body.aspect_ratio,
    });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
