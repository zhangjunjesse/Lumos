import { NextResponse } from 'next/server';
import crossFetch from 'cross-fetch';
import {
  createConfiguredHttpsProxyAgentForUrl,
  getConfiguredProxyForUrl,
} from '@/lib/net/proxy-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEST_URL = 'https://api.x.com/';
const TIMEOUT_MS = 10_000;

export async function POST() {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`连接测试超时 ${TIMEOUT_MS}ms`));
  }, TIMEOUT_MS);

  try {
    const agent = createConfiguredHttpsProxyAgentForUrl(TEST_URL);
    const proxyUrl = getConfiguredProxyForUrl(TEST_URL);
    const startedAt = Date.now();
    const response = await crossFetch(TEST_URL, {
      method: 'GET',
      signal: controller.signal,
      ...(agent ? { agent } : {}),
    } as Parameters<typeof crossFetch>[1]);
    const elapsedMs = Date.now() - startedAt;

    return NextResponse.json({
      ok: true,
      target: 'api.x.com',
      status: response.status,
      statusText: response.statusText,
      elapsedMs,
      proxyUrl: proxyUrl || '',
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      target: 'api.x.com',
      error: error instanceof Error ? error.message : String(error),
      proxyUrl: getConfiguredProxyForUrl(TEST_URL) || '',
    }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
