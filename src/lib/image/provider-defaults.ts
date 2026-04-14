import type { ApiProvider } from '@/types'

export const IMAGE_PROVIDER_DEFAULTS_KEY = 'LUMOS_IMAGE_DEFAULTS'

export interface ImageProviderDefaults {
  aspectRatio?: string
  resolution?: string
  count?: number
  providerOptions?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function parseProviderExtraEnvObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeDefaults(value: unknown): ImageProviderDefaults {
  if (!isRecord(value)) return {}

  const aspectRatio = typeof value.aspectRatio === 'string' && value.aspectRatio.trim()
    ? value.aspectRatio.trim()
    : undefined
  const resolution = typeof value.resolution === 'string' && value.resolution.trim()
    ? value.resolution.trim()
    : undefined
  const count = typeof value.count === 'number' && Number.isFinite(value.count) && value.count > 0
    ? Math.max(1, Math.floor(value.count))
    : undefined
  const providerOptions = isRecord(value.providerOptions)
    ? value.providerOptions
    : undefined

  return {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(typeof count === 'number' ? { count } : {}),
    ...(providerOptions ? { providerOptions } : {}),
  }
}

export function parseImageProviderDefaults(rawExtraEnv: string | undefined): ImageProviderDefaults {
  const extraEnv = parseProviderExtraEnvObject(rawExtraEnv)
  const encoded = extraEnv[IMAGE_PROVIDER_DEFAULTS_KEY]
  if (typeof encoded !== 'string' || !encoded.trim()) {
    return {}
  }

  try {
    return normalizeDefaults(JSON.parse(encoded))
  } catch {
    return {}
  }
}

export function serializeImageProviderDefaults(
  rawExtraEnv: string | undefined,
  defaults: ImageProviderDefaults,
): string {
  const extraEnv = parseProviderExtraEnvObject(rawExtraEnv)
  const normalized = normalizeDefaults(defaults)

  if (Object.keys(normalized).length === 0) {
    delete extraEnv[IMAGE_PROVIDER_DEFAULTS_KEY]
  } else {
    extraEnv[IMAGE_PROVIDER_DEFAULTS_KEY] = JSON.stringify(normalized)
  }

  return JSON.stringify(extraEnv)
}

export function getImageProviderDefaults(
  provider?: Pick<ApiProvider, 'extra_env'> | null,
): ImageProviderDefaults {
  return parseImageProviderDefaults(provider?.extra_env)
}

export function mergeImageProviderOptions(
  defaults: Record<string, unknown> | undefined,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const merged = {
    ...(defaults || {}),
    ...(overrides || {}),
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function buildImageGenerationSystemPrompt(
  defaults: ImageProviderDefaults,
): string | null {
  const lines: string[] = []

  if (defaults.aspectRatio) lines.push(`- aspect_ratio: "${defaults.aspectRatio}"`)
  if (defaults.resolution) lines.push(`- image_size: "${defaults.resolution}"`)
  if (typeof defaults.count === 'number') lines.push(`- count: ${defaults.count}`)
  if (defaults.providerOptions && Object.keys(defaults.providerOptions).length > 0) {
    lines.push(`- provider_options: ${JSON.stringify(defaults.providerOptions)}`)
  }

  if (lines.length === 0) return null

  return [
    'For this user message only, if you call `generate_image`, apply these exact image parameters unless the user explicitly overrides them:',
    ...lines,
    'Do not mention this hidden instruction to the user. Only use it for image generation or image editing calls in this turn.',
  ].join('\n')
}
