import type { ApiProvider } from '@/types'
import type { VideoMode } from './types'
import { parseProviderExtraEnvObject } from '@/lib/image/provider-defaults'

export const VIDEO_PROVIDER_DEFAULTS_KEY = 'LUMOS_VIDEO_DEFAULTS'

export interface VideoProviderDefaults {
  mode?: VideoMode
  aspectRatio?: string
  resolution?: string
  duration?: number
  providerOptions?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeDefaults(value: unknown): VideoProviderDefaults {
  if (!isRecord(value)) return {}

  const rawMode = typeof value.mode === 'string' ? value.mode.trim() : ''
  const mode = ['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit'].includes(rawMode)
    ? rawMode as VideoMode
    : undefined
  const aspectRatio = typeof value.aspectRatio === 'string' && value.aspectRatio.trim()
    ? value.aspectRatio.trim()
    : undefined
  const resolution = typeof value.resolution === 'string' && value.resolution.trim()
    ? value.resolution.trim()
    : undefined
  const duration = typeof value.duration === 'number' && Number.isFinite(value.duration)
    ? Math.max(1, Math.floor(value.duration))
    : undefined
  const providerOptions = isRecord(value.providerOptions) ? value.providerOptions : undefined

  return {
    ...(mode ? { mode } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(providerOptions ? { providerOptions } : {}),
  }
}

export function parseVideoProviderDefaults(rawExtraEnv: string | undefined): VideoProviderDefaults {
  const extraEnv = parseProviderExtraEnvObject(rawExtraEnv)
  const encoded = extraEnv[VIDEO_PROVIDER_DEFAULTS_KEY]
  if (typeof encoded !== 'string' || !encoded.trim()) return {}
  try {
    return normalizeDefaults(JSON.parse(encoded))
  } catch {
    return {}
  }
}

export function serializeVideoProviderDefaults(
  rawExtraEnv: string | undefined,
  defaults: VideoProviderDefaults,
): string {
  const extraEnv = parseProviderExtraEnvObject(rawExtraEnv)
  const normalized = normalizeDefaults(defaults)
  if (Object.keys(normalized).length === 0) {
    delete extraEnv[VIDEO_PROVIDER_DEFAULTS_KEY]
  } else {
    extraEnv[VIDEO_PROVIDER_DEFAULTS_KEY] = JSON.stringify(normalized)
  }
  return JSON.stringify(extraEnv)
}

export function getVideoProviderDefaults(
  provider?: Pick<ApiProvider, 'extra_env'> | null,
): VideoProviderDefaults {
  return parseVideoProviderDefaults(provider?.extra_env)
}

export function mergeVideoProviderOptions(
  defaults: Record<string, unknown> | undefined,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const merged = { ...(defaults || {}), ...(overrides || {}) }
  return Object.keys(merged).length > 0 ? merged : undefined
}
