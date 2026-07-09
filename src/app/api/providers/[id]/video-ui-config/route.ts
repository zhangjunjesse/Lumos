import { NextRequest, NextResponse } from 'next/server'
import { getProvider } from '@/lib/db'
import { providerSupportsCapability } from '@/lib/provider-config'
import { parseVideoProviderDefaults } from '@/lib/video/provider-defaults'
import { getVideoProviderUiConfig } from '@/lib/video/provider-ui'

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

    if (!providerSupportsCapability(provider, 'video-gen')) {
      return NextResponse.json({ error: 'Provider does not support video generation' }, { status: 400 })
    }

    return NextResponse.json({
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.provider_type,
      },
      uiConfig: getVideoProviderUiConfig(provider.provider_type),
      defaults: parseVideoProviderDefaults(provider.extra_env),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load video provider UI config' },
      { status: 500 },
    )
  }
}
