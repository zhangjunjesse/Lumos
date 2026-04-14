import { NextRequest, NextResponse } from 'next/server'
import { getProvider } from '@/lib/db'
import { ensureProvidersRegistered, resolveImageProvider } from '@/lib/image/registry'
import { getImageProviderUiConfig } from '@/lib/image/provider-ui'
import {
  parseImageProviderDefaults,
  parseProviderExtraEnvObject,
} from '@/lib/image/provider-defaults'
import { providerSupportsCapability } from '@/lib/provider-config'

interface RouteContext {
  params: Promise<{ id: string }>
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const provider = getProvider(id)
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    if (!providerSupportsCapability(provider, 'image-gen')) {
      return NextResponse.json({ error: 'Provider does not support image generation' }, { status: 400 })
    }

    await ensureProvidersRegistered()

    const providerEnv = parseProviderExtraEnvObject(provider.extra_env)
    const imageProvider = resolveImageProvider(provider.provider_type, {
      apiKey: provider.api_key || (typeof providerEnv.API_KEY === 'string' ? providerEnv.API_KEY : '') || 'placeholder',
      baseUrl: provider.base_url || undefined,
    })

    return NextResponse.json({
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.provider_type,
      },
      uiConfig: getImageProviderUiConfig(
        provider.provider_type,
        imageProvider.optionsSchema?.() ?? {},
      ),
      defaults: parseImageProviderDefaults(provider.extra_env),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load image provider UI config' },
      { status: 500 },
    )
  }
}
