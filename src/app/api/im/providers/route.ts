import { NextResponse } from 'next/server';
import {
  listPlugins,
  isProviderConfigured,
  isProviderEnabled,
  getDefaultProviderId,
} from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/im/providers
 *
 * 列出所有已注册的 IM provider，含 manifest + 当前 configured/enabled 状态 + 是否默认。
 * Settings UI 用这个一次性拿到全部信息渲染卡片。
 */
export async function GET() {
  try {
    const defaultId = getDefaultProviderId();
    const items = listPlugins().map((plugin) => ({
      manifest: plugin.manifest,
      configured: isProviderConfigured(plugin.manifest.id),
      enabled: isProviderEnabled(plugin.manifest.id),
      isDefault: defaultId === plugin.manifest.id,
    }));
    return NextResponse.json({ providers: items, defaultProviderId: defaultId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list IM providers';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
