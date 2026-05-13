import { NextRequest, NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import {
  getBrowserFetchSettings,
  setBrowserFetchSettings,
} from '@/lib/ecommerce-assistant/discover-settings';
import { fetchViaBrowser, BrowserFetchError } from '@/lib/ecommerce-assistant/browser-fetcher';
import { browserContextFallbackLabel, normalizeBrowserContextId } from '@/lib/browser-provider/labels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const settings = getBrowserFetchSettings(store);
    return NextResponse.json({
      enabled: settings.enabled,
      browserContextId: settings.browserContextId,
      browserLabel: browserContextFallbackLabel(settings.browserContextId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown> | null;
  try {
    body = (await req.json()) as Record<string, unknown> | null;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const patch: {
      enabled?: boolean;
      browserContextId?: string;
    } = {};
    if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body?.browserContextId === 'string') {
      patch.browserContextId = normalizeBrowserContextId(body.browserContextId);
    }
    const next = setBrowserFetchSettings(store, patch);
    return NextResponse.json({
      enabled: next.enabled,
      browserContextId: next.browserContextId,
      browserLabel: browserContextFallbackLabel(next.browserContextId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

/**
 * Connectivity test: try to fetch a simple URL through the Lumos browser runtime.
 * Returns ok=true on success, ok=false + reason on failure. Used by Settings
 * UI to give the user immediate feedback when configuring.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> | null;
  try {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown> | null;
  } catch {
    body = null;
  }
  const testUrl = String(body?.test_url ?? 'https://www.amazon.com/').trim();

  try {
    const store = getEcommerceStore();
    const saved = getBrowserFetchSettings(store);
    const settings = {
      ...saved,
      ...(typeof body?.browserContextId === 'string'
        ? { browserContextId: normalizeBrowserContextId(body.browserContextId) }
        : {}),
      ...(typeof body?.enabled === 'boolean' ? { enabled: body.enabled } : {}),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const result = await fetchViaBrowser(testUrl, settings, {
        timeoutMs: 60_000,
        abortSignal: ctrl.signal,
      });
      const looksLikeBlock = /captcha|robot|automated access/i.test(result.html.slice(0, 8000));
      return NextResponse.json({
        ok: !looksLikeBlock && result.html.length > 5000,
        url: result.url,
        html_length: result.html.length,
        elapsed_ms: result.elapsedMs,
        browser_context_id: result.browserContextId,
        browser_label: browserContextFallbackLabel(result.browserContextId),
        warning: looksLikeBlock ? '页面看起来像反爬挑战页（captcha / robot check）' : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof BrowserFetchError) {
      return NextResponse.json(
        { ok: false, reason: err.message, stage: err.stage },
        { status: 200 }, // not 500 — this is expected info, not server error
      );
    }
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}
