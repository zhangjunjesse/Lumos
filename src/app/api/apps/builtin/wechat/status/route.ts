import { NextResponse } from 'next/server';

import { getMcpServerByNameAndScope } from '@/lib/db';
import {
  getDefaultProviderId,
  isProviderConfigured,
  isProviderEnabled,
} from '@/lib/im';
import { resolveWechatMainAgentSession } from '@/lib/im/providers/wechat/main-agent-route';
import { getConsent, getDisclaimerHash, hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { runEnvProbes } from '@/lib/wechat-export/env-check';
import { getSetupStatus, getWeChatExportPlatform } from '@/lib/wechat-export/setup-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const imConfigured = isProviderConfigured('wechat');
  const imEnabled = isProviderEnabled('wechat');
  const defaultProviderId = getDefaultProviderId();
  const routedSession = resolveWechatMainAgentSession();
  const routedSessionId = routedSession?.id ?? null;

  const platform = getWeChatExportPlatform();
  if (!platform) {
    return NextResponse.json({
      app: builtinAppMeta('unsupported'),
      export: {
        supported: false,
        platform: process.platform,
        ready: false,
        phase: 'unsupported',
        message: '微信助手本机消息读取目前支持 macOS 和 Windows。',
      },
      im: {
        configured: imConfigured,
        enabled: imEnabled,
        isDefault: defaultProviderId === 'wechat',
        routedSessionId,
        routedSessionTitle: routedSession?.title ?? null,
      },
    });
  }

  const env = runEnvProbes(platform);
  const status = getSetupStatus(env.allOk, env.signed, platform);
  const mcp = getMcpServerByNameAndScope('wechat-export', 'builtin');
  const ready = status.phase === 'ready' && !!mcp && mcp.is_enabled === 1;

  return NextResponse.json({
    app: builtinAppMeta(ready ? 'ready' : status.phase),
    export: {
      supported: true,
      platform,
      ready,
      phase: status.phase,
      hasConsent: hasValidConsent(),
      consent: {
        hash: getDisclaimerHash(),
        record: getConsent(),
      },
      hasKey: status.hasKey,
      keyCount: status.keyCount,
      lastExtractedAt: status.lastExtractedAt,
      env,
      mcp: {
        installed: !!mcp,
        enabled: !!mcp && mcp.is_enabled === 1,
      },
    },
    im: {
      configured: imConfigured,
      enabled: imEnabled,
      isDefault: defaultProviderId === 'wechat',
      routedSessionId,
      routedSessionTitle: routedSession?.title ?? null,
    },
  });
}

function builtinAppMeta(status: string) {
  return {
    id: 'wechat-assistant',
    name: '微信助手',
    version: '0.1.0',
    source: 'builtin',
    category: 'communication',
    status,
  };
}
