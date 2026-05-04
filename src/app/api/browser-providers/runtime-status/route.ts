import { NextRequest, NextResponse } from 'next/server';
import {
  getFromBrowserBridge,
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';
import { listBrowserProviderConfigs } from '@/lib/db';
import type {
  BrowserProviderRuntimeReleaseRequest,
  BrowserProviderRuntimeReleaseResponse,
  BrowserProviderRuntimeStatus,
  BrowserProviderRuntimeStatusesResponse,
} from '@/types';

interface BridgeContextStatusResponse {
  ok?: boolean;
  browserContextId?: string;
  occupied?: boolean;
  ownerId?: string;
  startedAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  lastPath?: string;
  error?: string;
  message?: string;
}

interface BridgeContextReleaseResponse {
  ok?: boolean;
  browserContextId?: string;
  released?: boolean;
  previousOwnerId?: string;
  error?: string;
  message?: string;
}

const RUNTIME_STATUS_TIMEOUT_MS = 3_000;

async function readRuntimeStatus(contextId: string): Promise<BrowserProviderRuntimeStatus> {
  const bridgeConfig = resolveBrowserBridgeRuntimeConfig({ browserContextId: contextId });
  if (!bridgeConfig) {
    return {
      context_id: contextId,
      bridge_ready: false,
      occupied: false,
      error: '浏览器桥接服务未启动',
    };
  }

  try {
    const status = await getFromBrowserBridge<BridgeContextStatusResponse>(
      bridgeConfig,
      '/v1/context/status',
      { timeoutMs: RUNTIME_STATUS_TIMEOUT_MS },
    );
    return {
      context_id: contextId,
      bridge_ready: true,
      occupied: Boolean(status.occupied),
      ...(status.ownerId ? { owner_id: status.ownerId } : {}),
      ...(status.startedAt ? { started_at: status.startedAt } : {}),
      ...(status.updatedAt ? { updated_at: status.updatedAt } : {}),
      ...(status.expiresAt ? { expires_at: status.expiresAt } : {}),
      ...(status.lastPath ? { last_path: status.lastPath } : {}),
    };
  } catch (error) {
    return {
      context_id: contextId,
      bridge_ready: false,
      occupied: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  const configs = listBrowserProviderConfigs();
  const statuses = await Promise.all(configs.map((config) => readRuntimeStatus(config.context_id)));
  return NextResponse.json<BrowserProviderRuntimeStatusesResponse>({ statuses });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as BrowserProviderRuntimeReleaseRequest;
    const contextId = typeof body.context_id === 'string' ? body.context_id.trim() : '';
    if (!contextId || contextId === 'embedded:default') {
      return NextResponse.json(
        { error: '请选择一个第三方浏览器上下文' },
        { status: 400 },
      );
    }

    const bridgeConfig = resolveBrowserBridgeRuntimeConfig({ browserContextId: contextId });
    if (!bridgeConfig) {
      return NextResponse.json(
        { error: '浏览器桥接服务未启动' },
        { status: 503 },
      );
    }

    const result = await postToBrowserBridge<BridgeContextReleaseResponse>(
      bridgeConfig,
      '/v1/context/force-release',
      {},
      { timeoutMs: RUNTIME_STATUS_TIMEOUT_MS },
    );
    return NextResponse.json<BrowserProviderRuntimeReleaseResponse>({
      ok: true,
      context_id: contextId,
      released: Boolean(result.released),
      ...(result.previousOwnerId ? { previous_owner_id: result.previousOwnerId } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '释放浏览器占用失败' },
      { status: 500 },
    );
  }
}
