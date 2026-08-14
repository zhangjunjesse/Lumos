import { getProviderKind, type ImageKindUi } from '@/lib/provider-kinds'
import type { ProviderOptionsSchema } from './types'

export interface ImageProviderUiConfig {
  supportedAspectRatios: string[]
  supportedResolutions: string[]
  maxCount: number
  maxReferenceImages: number
  hint?: string
  advancedOptions: ProviderOptionsSchema
}

const FALLBACK_UI: ImageKindUi = {
  supportedAspectRatios: [
    '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9',
  ],
  supportedResolutions: ['1K', '2K', '4K'],
  maxCount: 4,
  maxReferenceImages: 4,
}

export function getImageProviderUiConfig(
  providerType: string,
  advancedOptions: ProviderOptionsSchema = {},
): ImageProviderUiConfig {
  const ui = getProviderKind(providerType)?.imageUi ?? FALLBACK_UI
  return {
    supportedAspectRatios: [...ui.supportedAspectRatios],
    supportedResolutions: [...ui.supportedResolutions],
    maxCount: ui.maxCount,
    maxReferenceImages: ui.maxReferenceImages,
    ...(ui.hint ? { hint: ui.hint } : {}),
    advancedOptions: ui.ignoreAdvancedOptions ? {} : advancedOptions,
  }
}
