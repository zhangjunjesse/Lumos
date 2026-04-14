import { NextResponse } from 'next/server'
import { resolveProviderForCapability } from '@/lib/provider-resolver'
import { ensureProvidersRegistered, resolveImageProvider } from '@/lib/image/registry'
import { getImageProviderUiConfig } from '@/lib/image/provider-ui'
import {
  parseImageProviderDefaults,
  parseProviderExtraEnvObject,
} from '@/lib/image/provider-defaults'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
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
      { error: error instanceof Error ? error.message : 'Failed to load image provider config' },
      { status: 500 },
    )
  }
}
