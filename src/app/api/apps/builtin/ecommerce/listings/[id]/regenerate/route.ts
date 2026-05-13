import { NextResponse } from 'next/server';

import {
  getEcommerceStore,
  getListingDraft,
} from '@/lib/ecommerce-assistant/storage';
import {
  draftListingForInput,
  ListingDrafterError,
} from '@/lib/ecommerce-assistant/listing-drafter';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * Regenerate the listing for the same (input × platform × language) tuple.
 * Reuses listing-drafter so the regenerated draft picks up any updated brief
 * (e.g. after the user uploaded a real photo and brief was re-identified).
 *
 * The OLD draft is archived (not deleted) so the user can compare.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: '缺少草稿 id。' }, { status: 400 });
    const store = getEcommerceStore();
    const old = getListingDraft(store, id);
    if (!old) return NextResponse.json({ error: '草稿不存在。' }, { status: 404 });

    // Archive the old draft so the regenerated one is the new live draft.
    store.update('listing_drafts', id, { status: 'archived' });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    let outcome;
    try {
      outcome = await draftListingForInput(
        store,
        {
          inputId: old.input_id,
          platform: old.platform,
          language: old.language,
        },
        ctrl.signal,
      );
    } catch (err) {
      // Restore old draft status if regeneration fails so the user is not
      // left with only an archived version.
      store.update('listing_drafts', id, { status: old.status });
      throw err;
    } finally {
      clearTimeout(timer);
    }
    return NextResponse.json({ draft: outcome.draft });
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof ListingDrafterError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
