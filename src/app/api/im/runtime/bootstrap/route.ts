/**
 * GET /api/im/runtime/bootstrap
 *
 * Electron im-runtime-manager 拉这个端点拿到当前 enabled 的所有 IM provider
 * 列表 + 各自的 raw config（不 mask），用于在主进程实例化 adapter。
 *
 * Phase C 起 feishu 也包含进来，取代 legacy /api/bridge/runtime/bootstrap。
 *
 * 鉴权：runtime-token 同样套用 bridge runtime 的 token 体系。
 */

import { NextResponse } from 'next/server';
import { bridgeRuntimeUnauthorizedResponse, isBridgeRuntimeAuthorized } from '@/lib/bridge/runtime-auth';
import { listPlugins, getProviderConfig, isProviderEnabled, isProviderConfigured } from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ImProviderBootstrap {
  providerId: string;
  config: Record<string, string>;
}

export async function GET(request: Request) {
  if (!isBridgeRuntimeAuthorized(request)) {
    return bridgeRuntimeUnauthorizedResponse();
  }

  const providers: ImProviderBootstrap[] = [];

  for (const plugin of listPlugins()) {
    const id = plugin.manifest.id;
    if (!isProviderEnabled(id)) continue;
    if (!isProviderConfigured(id)) continue;
    providers.push({
      providerId: id,
      config: getProviderConfig(id),
    });
  }

  return NextResponse.json({ providers });
}
