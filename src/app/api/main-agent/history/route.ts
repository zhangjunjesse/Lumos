import { NextRequest } from 'next/server';
import { listMainAgentSessions, sessionDayKey } from '@/lib/chat/main-agent-session';
import { findDailyReviewSession } from '@/lib/memory-v2/daily-review-store';
import { getDb } from '@/lib/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MessageCountRow {
  n: number;
}

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.max(1, Math.min(Number(limitParam) || 30, 90)) : 30;

    const sessions = listMainAgentSessions(limit);
    const db = getDb();
    const items = sessions.map((session) => {
      const day = sessionDayKey(session.created_at);
      const row = db
        .prepare(
          "SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND role IN ('user','assistant')",
        )
        .get(session.id) as MessageCountRow | undefined;
      const review = findDailyReviewSession(session.id);
      const digest = review?.session.digest;
      const firstEvent = digest?.events?.[0];
      const headline = firstEvent
        ? (firstEvent.requirement || firstEvent.outcome || '')
        : '';
      return {
        sessionId: session.id,
        day,
        title: session.title || day,
        status: session.status,
        messageCount: row?.n || 0,
        headline,
      };
    });
    return Response.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/main-agent/history] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
