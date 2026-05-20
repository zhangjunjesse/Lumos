import { NextRequest, NextResponse } from 'next/server';
import {
  findDailyReviewSession,
  setDailyReviewSessionDigest,
} from '@/lib/memory-v2/daily-review-store';
import { generateSessionDigest } from '@/lib/memory-v2/daily-review';
import { getSessionLinks } from '@/lib/memory-v2/digest-actions';
import { getSession } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = findDailyReviewSession(id);
    return NextResponse.json({
      sessionId: id,
      reviewDay: found?.reviewDay || '',
      session: found?.session || null,
      links: getSessionLinks(id),
      // 原始会话是否还在（删了也不影响分析/沉淀，只是看不到原对话）
      conversationAvailable: Boolean(getSession(id)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load session digest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 「理解总结」：现在就让 AI 读这个会话、生成总结并写回复盘记录。
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await generateSessionDigest(id);
    const session =
      (result.digest ? setDailyReviewSessionDigest(id, result.digest) : null)
      ?? findDailyReviewSession(id)?.session
      ?? null;
    return NextResponse.json({
      sessionId: id,
      status: result.status,
      error: result.reason || '',
      session: session || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate session digest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
