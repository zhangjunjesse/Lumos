import { NextRequest, NextResponse } from 'next/server'
import { resolveProviderForCapability } from '@/lib/provider-resolver'
import { ensureProvidersRegistered, resolveImageProvider } from '@/lib/image/registry'
import { getImageProviderUiConfig } from '@/lib/image/provider-ui'
import {
  parseImageProviderDefaults,
  parseProviderExtraEnvObject,
} from '@/lib/image/provider-defaults'
import { parseVideoProviderDefaults } from '@/lib/video/provider-defaults'
import { getVideoProviderUiConfig } from '@/lib/video/provider-ui'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get('type') === 'video' ? 'video' : 'image'

    if (type === 'video') {
      const provider = resolveProviderForCapability({
        moduleKey: 'video',
        capability: 'video-gen',
        allowDefault: false,
      })

      if (!provider) {
        return NextResponse.json({ error: '未配置视频生成服务商' }, { status: 404 })
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
    }

    await ensureProvidersRegistered()

    const provider = resolveProviderForCapability({
      moduleKey: 'image',
      capability: 'image-gen',
      allowDefault: false,
    })

    if (!provider) {
      return NextResponse.json({ error: '未配置图片生成服务商' }, { status: 404 })
    }

    const providerEnv = parseProviderExtraEnvObject(provider.extra_env)
    const imageProvider = resolveImageProvider(provider.provider_type, {
      apiKey: provider.api_key || (typeof providerEnv.API_KEY === 'string' ? providerEnv.API_KEY : '') || 'placeholder',
      baseUrl: provider.base_url || undefined,
    })
    const uiConfig = getImageProviderUiConfig(
      provider.provider_type,
      imageProvider.optionsSchema?.() ?? {},
    )

    return NextResponse.json({
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.provider_type,
      },
      uiConfig,
      defaults: parseImageProviderDefaults(provider.extra_env),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load media provider config' },
      { status: 500 },
    )
  }
}
