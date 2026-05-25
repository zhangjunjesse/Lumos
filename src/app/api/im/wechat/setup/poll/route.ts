/**
 * GET /api/im/wechat/setup/poll?qrKey=<key>&apiBase=<base>
 *
 * 长轮询绑定状态。服务端 ilink 网关已经做了长轮询（~35s），UI 只需在收到
 * "wait" / "scaned" 时立即再调一次即可。
 *
 * 返回：
 *   { status: 'wait' | 'scaned' | 'expired' }
 *   { status: 'confirmed' }  — 同时把 token + base_url 写入 settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { pollQRStatus } from '@/lib/im/providers/wechat/setup';
import { setProviderField } from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qrKey = url.searchParams.get('qrKey')?.trim();
  const apiBase = url.searchParams.get('apiBase')?.trim() || undefined;
  const routeTag = url.searchParams.get('routeTag')?.trim() || undefined;
  if (!qrKey) {
    return NextResponse.json({ error: 'qrKey required' }, { status: 400 });
  }

  let status;
  try {
    status = await pollQRStatus(qrKey, { apiBase, routeTag });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'poll failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (status.status === 'confirmed') {
    const token = (status.bot_token || '').trim();
    if (!token) {
      return NextResponse.json(
        { error: 'login confirmed but bot_token missing' },
        { status: 502 },
      );
    }
    setProviderField('wechat', 'token', token);
    if (status.baseurl && status.baseurl.trim()) {
      setProviderField('wechat', 'base_url', status.baseurl.trim());
    }
    if (routeTag) {
      setProviderField('wechat', 'route_tag', routeTag);
    }
    const accountId = (status.ilink_bot_id || status.ilink_user_id || '').trim();
    if (accountId) {
      setProviderField('wechat', 'account_id', accountId);
    }
    return NextResponse.json({
      status: 'confirmed',
      ilinkBotId: status.ilink_bot_id,
      ilinkUserId: status.ilink_user_id,
      baseUrl: status.baseurl,
    });
  }

  return NextResponse.json({ status: status.status });
}
