import { NextRequest, NextResponse } from 'next/server';

import {
  getKeywordStore,
  getKeywordRun,
  deleteKeywordRun,
} from '@/lib/ecommerce-assistant/keyword-research-storage';
import { cancelKeywordRun } from '@/lib/ecommerce-assistant/keyword-research-lifecycle';
import type { KeywordResearchReport } from '@/lib/ecommerce-assistant/keyword-research-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — one run + parsed report. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = getKeywordRun(getKeywordStore(), id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let report: KeywordResearchReport | null = null;
  if (row.report_json) {
    try {
      report = JSON.parse(row.report_json) as KeywordResearchReport;
    } catch {
      report = null;
    }
  }
  return NextResponse.json({
    run: {
      id: row.id,
      status: row.status,
      stage: row.stage,
      progress: row.progress,
      category_label: row.category_label,
      summary: row.summary,
      error: row.error,
      ehunt_detected: row.ehunt_detected,
      created_at: row.created_at,
      completed_at: row.completed_at,
    },
    report,
    report_markdown: row.report_markdown,
  });
}

/**
 * POST { action: 'cancel' } — stop a running/pending run WITHOUT deleting it.
 * Delegates to the centralized lifecycle service (abort live work + zombie
 * reconciliation); the visible record stays so the user keeps partial output.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const store = getKeywordStore();
  const row = getKeywordRun(store, id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let action = 'cancel';
  try {
    const body = (await req.json()) as { action?: unknown };
    if (typeof body.action === 'string') action = body.action;
  } catch {
    /* default to cancel */
  }
  if (action !== 'cancel') {
    return NextResponse.json({ error: 'unsupported_action' }, { status: 400 });
  }
  const cancelled = cancelKeywordRun(id);
  return NextResponse.json({ ok: true, cancelled });
}

/**
 * DELETE — cancel if running, then remove the run (lifecycle-correct:
 * abort live work before deleting the visible record).
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const store = getKeywordStore();
  if (!getKeywordRun(store, id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  cancelKeywordRun(id);
  deleteKeywordRun(store, id);
  return NextResponse.json({ ok: true });
}
