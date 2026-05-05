import { NextResponse } from 'next/server';

import { getMcpServerByNameAndScope, getSession } from '@/lib/db';
import {
  getDefaultProviderId,
  isProviderConfigured,
  isProviderEnabled,
} from '@/lib/im';
import { getCurrentRoutedSessionId } from '@/lib/im/providers/wechat/route-pointer';
import { getConsent, getDisclaimerHash, hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { runEnvProbes } from '@/lib/wechat-export/env-check';
import { getSetupStatus } from '@/lib/wechat-export/setup-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const imConfigured = isProviderConfigured('wechat');
  const imEnabled = isProviderEnabled('wechat');
  const defaultProviderId = getDefaultProviderId();
  const routedSessionId = getCurrentRoutedSessionId();
  const routedSession = routedSessionId ? getSession(routedSessionId) : null;

  if (process.platform !== 'darwin') {
    return NextResponse.json({
      app: builtinAppMeta('unsupported'),
      export: {
        supported: false,
        platform: process.platform,
        ready: false,
        phase: 'unsupported',
        message: '微信消息读取 Demo 目前先支持 macOS 本机微信。Windows 后续补齐。',
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

  const env = runEnvProbes();
  const status = getSetupStatus(env.allOk, env.signed);
  const mcp = getMcpServerByNameAndScope('wechat-export', 'builtin');
  const ready = status.phase === 'ready' && !!mcp && mcp.is_enabled === 1;

  return NextResponse.json({
    app: builtinAppMeta(ready ? 'ready' : status.phase),
    export: {
      supported: true,
      platform: 'darwin',
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
