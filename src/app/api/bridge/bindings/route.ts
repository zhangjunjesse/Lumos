import { NextRequest, NextResponse } from 'next/server';
import { getBridgeService } from '@/lib/bridge/app/bridge-service';

function toErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Failed to create binding';
  if (message === 'FEISHU_NOT_CONFIGURED') {
    return NextResponse.json({
      error: 'FEISHU_NOT_CONFIGURED',
      message: '请先配置飞书应用',
      action: 'goto_settings',
    }, { status: 400 });
  }
  if (
    message === 'FEISHU_AUTH_REQUIRED' ||
    message === 'FEISHU_AUTH_EXPIRED' ||
    message === 'FEISHU_USER_INFO_MISSING'
  ) {
    return NextResponse.json({
      error: message,
      message:
        message === 'FEISHU_AUTH_EXPIRED'
          ? '飞书登录已过期，请重新登录后再同步'
          : message === 'FEISHU_USER_INFO_MISSING'
            ? '飞书账号信息不完整，请退出后重新登录'
            : '请先在设置中登录飞书账号后再同步',
      action: 'goto_feishu_login',
    }, { status: 401 });
  }
  if (message === 'SESSION_NOT_FOUND') {
    return NextResponse.json({
      error: 'SESSION_NOT_FOUND',
      message: '当前会话不存在或已被删除，请刷新会话列表后重试',
      action: 'refresh_sessions',
    }, { status: 404 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const bridgeService = getBridgeService();
    const result = await bridgeService.bindChannel({ sessionId, platform: 'feishu' });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Bindings POST] Failed to create binding:', error);
    return toErrorResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const bridgeService = getBridgeService();
    const sessionBindings = bridgeService.getSessionBindings(sessionId, 'feishu');
    const bindings = sessionBindings.map((binding) => ({
      id: binding.id,
      session_id: binding.sessionId,
      sessionId: binding.sessionId,
      platform: binding.platform,
      platform_chat_id: binding.channelId,
      chatId: binding.channelId,
      platform_chat_name: binding.channelName,
      share_link: binding.shareLink,
      status: binding.status,
      created_at: binding.createdAt,
      createdAt: binding.createdAt,
      updated_at: binding.updatedAt,
    }));

    return NextResponse.json({ bindings });
  } catch (error) {
    console.error('[Bindings GET] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to query bindings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
