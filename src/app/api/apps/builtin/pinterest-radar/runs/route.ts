import { NextRequest, NextResponse } from 'next/server';

import { createRun, listRuns } from '@/lib/pinterest-radar/runs';
import { startCascadeFromCreation } from '@/lib/pinterest-radar/cascade';
import { DEFAULT_RUN_CONFIG, type CascadeTarget, type CreateRunInput, type TrendsPreset } from '@/lib/pinterest-radar/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const runs = listRuns();
    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateRunInput>;
    if (!body.label || typeof body.label !== 'string' || body.label.length > 80) {
      return NextResponse.json({ error: 'label is required (1-80 chars)' }, { status: 400 });
    }
    const cfgInput = (body.config ?? {}) as Partial<typeof DEFAULT_RUN_CONFIG>;
    const validCascade: CascadeTarget[] = ['none', 'collect', 'metrics', 'analyze', 'etsy_listings', 'report'];
    const validPreset: TrendsPreset[] = ['growing', 'seasonal', 'monthly', 'yearly'];

    const config = {
      country: typeof cfgInput.country === 'string' && cfgInput.country.length === 2 ? cfgInput.country.toUpperCase() : DEFAULT_RUN_CONFIG.country,
      preset: validPreset.includes(cfgInput.preset as TrendsPreset) ? (cfgInput.preset as TrendsPreset) : DEFAULT_RUN_CONFIG.preset,
      category: typeof cfgInput.category === 'string' ? cfgInput.category.trim() : '',
      collectLimit: typeof cfgInput.collectLimit === 'number' && cfgInput.collectLimit >= 20 && cfgInput.collectLimit <= 100
        ? cfgInput.collectLimit : DEFAULT_RUN_CONFIG.collectLimit,
      metricsDays: typeof cfgInput.metricsDays === 'number' && cfgInput.metricsDays >= 7 && cfgInput.metricsDays <= 90
        ? cfgInput.metricsDays : DEFAULT_RUN_CONFIG.metricsDays,
      cascadeTo: validCascade.includes(cfgInput.cascadeTo as CascadeTarget) ? (cfgInput.cascadeTo as CascadeTarget) : DEFAULT_RUN_CONFIG.cascadeTo,
      browserContextId: typeof cfgInput.browserContextId === 'string' && cfgInput.browserContextId.trim().length > 0 ? cfgInput.browserContextId.trim() : undefined,
    };

    const run = createRun({ label: body.label.trim(), config });
    startCascadeFromCreation(run.id);
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
