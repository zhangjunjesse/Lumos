import { NextResponse } from 'next/server';
import { bridgeRuntimeUnauthorizedResponse, isBridgeRuntimeAuthorized } from '@/lib/bridge/runtime-auth';
import { getFeishuCredentials } from '@/lib/feishu-config';
import { BindingService } from '@/lib/bridge/core/binding-service';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isBridgeRuntimeAuthorized(request)) {
    return bridgeRuntimeUnauthorizedResponse();
  }

  const { appId, appSecret } = getFeishuCredentials();
  const bindingService = new BindingService();
  const db = getDb();
  const bindings = bindingService.listActiveBindings('feishu').map((binding) => {
    const latestInboundAt = db.prepare(
      `SELECT MAX(created_at) AS latestInboundAt
       FROM bridge_events
       WHERE binding_id = ? AND direction = 'inbound'`
    ).get(binding.id) as { latestInboundAt: number | null };

    return {
      bindingId: binding.id,
      sessionId: binding.sessionId,
      chatId: binding.channelId,
      createdAt: binding.createdAt,
      lastInboundAt: latestInboundAt.latestInboundAt ?? null,
    };
  });

  return NextResponse.json({
    feishu: {
      configured: Boolean(appId && appSecret),
      appId,
      appSecret,
      domain: 'feishu',
      bindings,
    },
  });
}
