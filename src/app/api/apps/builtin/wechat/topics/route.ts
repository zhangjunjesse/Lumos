import { NextRequest, NextResponse } from 'next/server';

import {
  filterTopicRangeSummaryByAllowedWxids,
  getTopicRangeSummary,
  type TopicScope,
} from '@/lib/wechat-assistant/mirror-store';
import { getWeChatAssistantSettings } from '@/lib/wechat-assistant/settings-store';
import {
  isTopicExtractionInFlight,
  runDueTopicExtractions,
  runTopicExtraction,
  type TopicProgressEvent,
} from '@/lib/wechat-assistant/topic-extractor';
import {
  compareBusinessDates,
  defaultTopicDateRange,
  lastCompletedBusinessDate,
  normalizeBusinessDate,
} from '@/lib/wechat-assistant/topic-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — return archived summaries in a date range + in-flight flags. */
export async function GET(req: NextRequest) {
  runDueTopicExtractions().catch((error: unknown) => {
    console.warn('[wechat-assistant] daily topic extraction kick failed:', error);
  });
  const settings = getWeChatAssistantSettings();
  const url = new URL(req.url);
  const fallback = defaultTopicDateRange();
  let from = normalizeBusinessDate(url.searchParams.get('from')) ?? fallback.from;
  let to = normalizeBusinessDate(url.searchParams.get('to')) ?? fallback.to;
  if (compareBusinessDates(from, to) > 0) [from, to] = [to, from];
  const personalAllowed = allowedTopicWxids('personal', settings);
  const groupAllowed = allowedTopicWxids('group', settings);
  return NextResponse.json({
    dateFrom: from,
    dateTo: to,
    personal: {
      ...filterTopicRangeSummaryByAllowedWxids(getTopicRangeSummary('personal', from, to), personalAllowed),
      inFlight: isTopicExtractionInFlight('personal'),
    },
    group: {
      ...filterTopicRangeSummaryByAllowedWxids(getTopicRangeSummary('group', from, to), groupAllowed),
      inFlight: isTopicExtractionInFlight('group'),
    },
  });
}

interface RunTopicsRequest {
  scope: TopicScope;
  businessDate?: string;
}

/**
 * POST — start an extraction run for a single scope, NDJSON streaming progress.
 *
 * Body: `{ "scope": "personal" | "group", "businessDate"?: "YYYY-MM-DD" }`
 */
export async function POST(req: NextRequest) {
  let body: Partial<RunTopicsRequest>;
  try {
    body = (await req.json()) as Partial<RunTopicsRequest>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const scope = body.scope;
  if (scope !== 'personal' && scope !== 'group') {
    return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
  }
  const businessDate = normalizeBusinessDate(body.businessDate) ?? lastCompletedBusinessDate();

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (event: TopicProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      void runTopicExtraction({
        scope,
        businessDate,
        signal: abort.signal,
        onEvent: writeEvent,
      })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          writeEvent({ type: 'error', scope, message });
        })
        .finally(() => controller.close());
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function allowedTopicWxids(scope: TopicScope, settings: ReturnType<typeof getWeChatAssistantSettings>): Set<string> {
  const raw = scope === 'personal'
    ? settings.topicAnalysis.whitelistPersonal
    : settings.topicAnalysis.whitelistGroups;
  const excluded = new Set(settings.excludedPersonIds);
  return new Set(raw.filter((wxid) => !excluded.has(wxid)));
}
