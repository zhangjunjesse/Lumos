import { NextRequest, NextResponse } from 'next/server';
import { GoofishCliException } from '@/lib/goofish/cli';
import { listChatsEnriched } from '@/lib/goofish/messages';
import { getAuthStatus } from '@/lib/goofish/auth';
import { goofishAuthExpiredResponse, isGoofishAuthExpiredError } from '@/lib/goofish/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/goofish/chats?limit=N
 *
 * Returns the user's recent conversations, newest first. Drives the WeChat-like
 * list under the login card on the GoofishPanel. Read-only — does not touch
 * the MCP toggle or cookies.
 */
export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = Math.max(1, Math.min(200, Number(limitParam) || 50));
  // ?watch=N -> short-lived ACCS WebSocket subscription to collect session
  // activations the baseline session.sync API drops. 8s is enough for the
  // server's pending push queue to drain. 0 = baseline only (fast polling).
  const watchParam = req.nextUrl.searchParams.get('watch');
  const watchSecs = Math.max(0, Math.min(15, Number(watchParam) || 0));

  try {
    // Need own unb to identify "peer" vs "me" when enriching watch skeletons.
    // We don't fail the whole list if status check is flaky; just skip enrich.
    const status = await getAuthStatus().catch(() => null);
    const result = await listChatsEnriched(limit, watchSecs, status?.unb ?? '');
    // 过滤：留下真实买家对话（session_type ∈ {0,1}），丢掉系统流——
    //   3 = 系统消息    6 = 留言    23 = 卖家小助手 / 热门活动
    //   0 = 新会话/未分类（部分 watch 推送是这个，里面也有真实消息）
    // 这样 baseline 里的历史买家对话 + watch 里的最近活跃对话都会显示。
    let sessions = result.sessions.filter((s) => s.session_type === 0 || s.session_type === 1);
    // 丢掉补全后仍然没有对方信息的"僵尸"会话（只有评价提醒/确认收货推送，
    // 没真实对话内容），UI 上展示为"会话 #xxx"反而困惑。
    sessions = sessions.filter((s) => s.peer_nick || s.peer_user_id);
    // 时间倒序：最新活跃在最上面。
    sessions = [...sessions].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return NextResponse.json({
      ok: true,
      sessions,
      readReceipts: result.readReceipts,
      watchFell: result.watchFell,
    });
  } catch (err) {
    if (isGoofishAuthExpiredError(err)) {
      return goofishAuthExpiredResponse();
    }
    if (err instanceof GoofishCliException) {
      const httpStatus = err.code === 'NOT_INSTALLED' ? 503 : 400;
      return NextResponse.json({
        ok: false,
        code: err.code,
        message: err.message,
      }, { status: httpStatus });
    }
    return NextResponse.json({
      ok: false,
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
