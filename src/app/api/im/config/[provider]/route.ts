import { NextRequest, NextResponse } from 'next/server';
import {
  getPlugin,
  getProviderConfig,
  setProviderConfig,
  isProviderConfigured,
} from '@/lib/im';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECRET_MASK_PREFIX = '***';

function maskValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length);
  return `${SECRET_MASK_PREFIX}${trimmed.slice(-8)}`;
}

interface RouteParams {
  params: Promise<{ provider: string }>;
}

/**
 * GET /api/im/config/[provider]
 * Reads stored config; secret fields are masked.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { provider } = await params;
    const plugin = getPlugin(provider);
    if (!plugin) return NextResponse.json({ error: 'unknown provider' }, { status: 404 });

    const stored = getProviderConfig(provider);
    const config: Record<string, string> = {};
    for (const field of plugin.manifest.configSchema) {
      const value = stored[field.key] ?? '';
      config[field.key] = field.type === 'secret' ? maskValue(value) : value;
    }

    return NextResponse.json({
      manifest: plugin.manifest,
      config,
      configured: isProviderConfigured(provider),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/im/config/[provider]
 * body: { config: { [field.key]: string } }
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { provider } = await params;
    const plugin = getPlugin(provider);
    if (!plugin) return NextResponse.json({ error: 'unknown provider' }, { status: 404 });

    const body = (await req.json()) as { config?: Record<string, unknown> };
    if (!body?.config || typeof body.config !== 'object') {
      return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
    }

    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.config)) {
      patch[k] = typeof v === 'string' ? v : v == null ? '' : String(v);
    }

    setProviderConfig(provider, patch, { allowSecretMaskPassthrough: true });

    return NextResponse.json({
      success: true,
      configured: isProviderConfigured(provider),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
