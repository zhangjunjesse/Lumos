import { NextRequest, NextResponse } from 'next/server';

import {
  getEcommerceStore,
  getListingDraft,
  patchListingDraft,
} from '@/lib/ecommerce-assistant/storage';
import { recordAuditEvent } from '@/lib/ecommerce-assistant/audit-log';
import { seedFollowupsForListing } from '@/lib/ecommerce-assistant/listing-followup';
import type { ListingDraftRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const draft = getListingDraft(store, id);
    if (!draft) return NextResponse.json({ error: '草稿不存在。' }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Inline editing of an existing listing draft. Only user-editable fields
 * (title / bullets / description / search_keywords / status) are honored.
 * Bullets and search_keywords accept either a JSON string (raw passthrough)
 * or an array of strings (will be JSON-stringified for storage).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown> | null;
  try {
    body = (await req.json()) as Record<string, unknown> | null;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  try {
    const store = getEcommerceStore();
    const patch: Partial<ListingDraftRecord> = {};
    if (typeof body?.title === 'string') patch.title = body.title;
    if (typeof body?.description === 'string') patch.description = body.description;
    if (Array.isArray(body?.bullets)) {
      patch.bullets = JSON.stringify(
        (body!.bullets as unknown[]).map((b) => String(b)).filter((b) => b.length > 0),
      );
    } else if (typeof body?.bullets === 'string') {
      patch.bullets = body.bullets;
    }
    if (Array.isArray(body?.search_keywords)) {
      patch.search_keywords = JSON.stringify(
        (body!.search_keywords as unknown[]).map((k) => String(k)).filter((k) => k.length > 0),
      );
    } else if (typeof body?.search_keywords === 'string') {
      patch.search_keywords = body.search_keywords;
    }
    const ALLOWED_STATUS = [
      'drafting',
      'ready',
      'failed',
      'archived',
      'submitted',
      'live',
      'rejected',
    ] as const;
    if (
      typeof body?.status === 'string' &&
      (ALLOWED_STATUS as readonly string[]).includes(body.status)
    ) {
      patch.status = body.status as ListingDraftRecord['status'];
      const now = new Date().toISOString();
      // Stamp lifecycle timestamps automatically when transitioning. We don't
      // overwrite an existing timestamp so the record keeps the first-time-it-
      // happened audit value.
      if (body.status === 'submitted') {
        const cur = await getCurrentTimestamps(id);
        if (!cur?.submitted_at) patch.submitted_at = now;
      }
      if (body.status === 'live') {
        const cur = await getCurrentTimestamps(id);
        if (!cur?.live_at) patch.live_at = now;
      }
      if (body.status === 'rejected') {
        const cur = await getCurrentTimestamps(id);
        if (!cur?.rejected_at) patch.rejected_at = now;
      }
    }
    if (typeof body?.live_url === 'string') patch.live_url = body.live_url || null;
    if (typeof body?.rejection_reason === 'string') {
      patch.rejection_reason = body.rejection_reason || null;
    }
    if (typeof body?.user_notes === 'string') patch.user_notes = body.user_notes || null;
    const updated = patchListingDraft(store, id, patch);
    if (!updated) return NextResponse.json({ error: '草稿不存在。' }, { status: 404 });

    // Distinguish status-transition events (high-signal for activity feed)
    // from plain content edits.
    const statusChanged =
      patch.status !== undefined && patch.status !== updated.status
        ? false /* nothing actually changed */
        : patch.status !== undefined;
    if (statusChanged) {
      const transitionDetail: Record<string, unknown> = { to: patch.status };
      if (patch.live_url !== undefined) transitionDetail.live_url = patch.live_url;
      if (patch.rejection_reason !== undefined) {
        transitionDetail.rejection_reason = patch.rejection_reason;
      }
      recordAuditEvent(store, {
        kind: 'listing-status-changed',
        targetId: updated.id,
        targetType: 'listing',
        inputId: updated.input_id,
        summary: `Listing 状态 → ${patch.status}（${updated.platform}/${updated.language}）`,
        payload: transitionDetail,
      });

      // Side effect: seed the post-launch follow-up checklist on first
      // transition to live. seedFollowupsForListing is idempotent so re-
      // transitioning to live (e.g. after a temporary 'rejected' bounce)
      // does not duplicate todos.
      if (patch.status === 'live') {
        try {
          seedFollowupsForListing(store, updated as ListingDraftRecord & { id: string });
        } catch (err) {
          console.warn('[ecommerce-assistant] seed followups failed:', err);
        }
      }
    } else {
      const fields = Object.keys(patch).filter((k) => k !== 'status');
      if (fields.length > 0) {
        recordAuditEvent(store, {
          kind: 'listing-edited',
          targetId: updated.id,
          targetType: 'listing',
          inputId: updated.input_id,
          summary: `Listing 编辑（${updated.platform}/${updated.language}, ${fields.length} 字段）`,
          payload: { changed_fields: fields },
        });
      }
    }
    return NextResponse.json({ draft: updated });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const store = getEcommerceStore();
    const ok = store.delete('listing_drafts', id);
    if (!ok) return NextResponse.json({ error: '草稿不存在。' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function getCurrentTimestamps(id: string): Promise<{
  submitted_at: string | null;
  live_at: string | null;
  rejected_at: string | null;
} | null> {
  const store = getEcommerceStore();
  const draft = getListingDraft(store, id);
  if (!draft) return null;
  return {
    submitted_at: draft.submitted_at ?? null,
    live_at: draft.live_at ?? null,
    rejected_at: draft.rejected_at ?? null,
  };
}
