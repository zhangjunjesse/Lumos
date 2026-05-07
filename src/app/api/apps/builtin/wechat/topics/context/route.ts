import { NextRequest, NextResponse } from 'next/server';

import { getTopicMessageContext } from '@/lib/wechat-assistant/mirror-store';
import { getWeChatAssistantSettings } from '@/lib/wechat-assistant/settings-store';
import { compareBusinessDates, defaultTopicDateRange, normalizeBusinessDate } from '@/lib/wechat-assistant/topic-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const wxid = url.searchParams.get('wxid')?.trim() ?? '';
  const title = url.searchParams.get('title')?.trim() ?? '';
  const summary = url.searchParams.get('summary')?.trim() ?? '';
  const fallback = defaultTopicDateRange();
  let dateFrom = normalizeBusinessDate(url.searchParams.get('from')) ?? fallback.from;
  let dateTo = normalizeBusinessDate(url.searchParams.get('to')) ?? fallback.to;
  if (compareBusinessDates(dateFrom, dateTo) > 0) [dateFrom, dateTo] = [dateTo, dateFrom];
  if (!wxid || !title) {
    return NextResponse.json({ error: 'missing_topic_context_params' }, { status: 400 });
  }
  if (!isAllowedTopicWxid(wxid)) {
    return NextResponse.json({ error: 'topic_context_not_found' }, { status: 404 });
  }
  const context = getTopicMessageContext({
    wxid,
    title,
    summary,
    dateFrom,
    dateTo,
    radius: 10,
  });
  if (!context) {
    return NextResponse.json({ error: 'topic_context_not_found' }, { status: 404 });
  }
  return NextResponse.json({ context });
}

function isAllowedTopicWxid(wxid: string): boolean {
  const settings = getWeChatAssistantSettings();
  if (settings.excludedPersonIds.includes(wxid)) return false;
  return (
    settings.topicAnalysis.whitelistPersonal.includes(wxid)
    || settings.topicAnalysis.whitelistGroups.includes(wxid)
  );
}
