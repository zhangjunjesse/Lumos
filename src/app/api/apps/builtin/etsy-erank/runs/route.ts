import { NextRequest, NextResponse } from 'next/server';

import { createRun, listRuns } from '@/lib/etsy-erank/runs';
import { startCascadeFromCreation } from '@/lib/etsy-erank/cascade';
import { DEFAULT_RUN_CONFIG, type CascadeTarget, type CreateRunInput } from '@/lib/etsy-erank/types';

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
    if (body.entryMode !== 'with_capability' && body.entryMode !== 'blank_slate') {
      return NextResponse.json({ error: 'entryMode must be with_capability | blank_slate' }, { status: 400 });
    }
    if (body.entryMode === 'with_capability' && (!Array.isArray(body.capabilities) || body.capabilities.length === 0)) {
      return NextResponse.json({ error: 'capabilities[] required for with_capability mode' }, { status: 400 });
    }
    // 校验 config(用 default 兜底,允许部分覆盖)
    const cfgInput = (body.config ?? {}) as Partial<typeof DEFAULT_RUN_CONFIG>;
    const validCascade: CascadeTarget[] = ['none', 'seed', 'converge', 'verify', 'score', 'analyze'];
    const config = {
      seedTimeframe: typeof cfgInput.seedTimeframe === 'string' && cfgInput.seedTimeframe.length > 0 ? cfgInput.seedTimeframe : DEFAULT_RUN_CONFIG.seedTimeframe,
      seedLimit: typeof cfgInput.seedLimit === 'number' && cfgInput.seedLimit >= 10 && cfgInput.seedLimit <= 200 ? cfgInput.seedLimit : DEFAULT_RUN_CONFIG.seedLimit,
      verifyMaxBatches: typeof cfgInput.verifyMaxBatches === 'number' && cfgInput.verifyMaxBatches >= 1 && cfgInput.verifyMaxBatches <= 100 ? cfgInput.verifyMaxBatches : DEFAULT_RUN_CONFIG.verifyMaxBatches,
      cascadeTo: validCascade.includes(cfgInput.cascadeTo as CascadeTarget) ? (cfgInput.cascadeTo as CascadeTarget) : DEFAULT_RUN_CONFIG.cascadeTo,
      browserContextId: typeof cfgInput.browserContextId === 'string' && cfgInput.browserContextId.trim().length > 0 ? cfgInput.browserContextId.trim() : undefined,
    };

    const run = createRun({
      label: body.label.trim(),
      entryMode: body.entryMode,
      capabilities: body.capabilities,
      executor: body.executor === 'paste' ? 'paste' : 'adspower',
      market: body.market,
      platform: body.platform,
      config,
    });
    // 创建后立即启动级联(cascadeTo='none' 时 startCascadeFromCreation 内部什么都不做)
    startCascadeFromCreation(run.id);
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
