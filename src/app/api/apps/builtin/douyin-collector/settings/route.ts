import { NextRequest, NextResponse } from 'next/server';

import {
  getDouyinCollectorSettings,
  updateDouyinCollectorSettings,
} from '@/lib/douyin-collector/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = getDouyinCollectorSettings();
  return NextResponse.json({
    settings: {
      ...settings,
      // Don't echo the full Cookie value back to the client. We only need to
      // know whether one has been set, when it was last saved, and a short
      // preview to help the user recognize which one is in place.
      cookie: '',
      cookieConfigured: settings.cookie.length > 0,
      cookiePreview: settings.cookie.length > 0 ? `${settings.cookie.slice(0, 16)}…` : null,
    },
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Parameters<typeof updateDouyinCollectorSettings>[0] = {};
    if (typeof body.cookie === 'string') patch.cookie = body.cookie;
    if (typeof body.transcribePrefer === 'string') {
      patch.transcribePrefer = body.transcribePrefer as never;
    }
    if (typeof body.longVideoSplitMinutes === 'number') {
      patch.longVideoSplitMinutes = body.longVideoSplitMinutes;
    }
    if (typeof body.transcribeConcurrency === 'number') {
      patch.transcribeConcurrency = body.transcribeConcurrency;
    }
    if (body.libraryCollectionId === null || typeof body.libraryCollectionId === 'string') {
      patch.libraryCollectionId = body.libraryCollectionId;
    }
    if (typeof body.autoPublish === 'boolean') patch.autoPublish = body.autoPublish;
    if (typeof body.autoSummarize === 'boolean') patch.autoSummarize = body.autoSummarize;
    if (typeof body.autoTranscribe === 'boolean') patch.autoTranscribe = body.autoTranscribe;
    if (typeof body.dedupeCollect === 'boolean') patch.dedupeCollect = body.dedupeCollect;
    if (typeof body.aiSummaryPrompt === 'string') patch.aiSummaryPrompt = body.aiSummaryPrompt;
    if (typeof body.aiChaptersPrompt === 'string') patch.aiChaptersPrompt = body.aiChaptersPrompt;
    if (typeof body.aiTagsPrompt === 'string') patch.aiTagsPrompt = body.aiTagsPrompt;
    if (typeof body.riskNote === 'string') patch.riskNote = body.riskNote;
    if (typeof body.browserContextId === 'string') {
      patch.browserContextId = body.browserContextId;
    }

    const updated = updateDouyinCollectorSettings(patch);
    return NextResponse.json({
      settings: {
        ...updated,
        cookie: '',
        cookieConfigured: updated.cookie.length > 0,
        cookiePreview: updated.cookie.length > 0 ? `${updated.cookie.slice(0, 16)}…` : null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
