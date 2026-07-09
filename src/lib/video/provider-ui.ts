import type { VideoProviderDefaults } from './provider-defaults'
import { unionOfKnownProfiles } from './model-profiles'

export interface VideoProviderUiConfig {
  supportedModes: Array<{ value: string; label: string }>
  supportedAspectRatios: string[]
  supportedResolutions: string[]
  supportedDurations: number[]
  maxReferenceImages: number
  maxReferenceVideos: number
  hint?: string
}

export interface VideoProviderUiConfigResponse {
  provider: { id: string; name: string; type: string }
  uiConfig: VideoProviderUiConfig
  defaults?: VideoProviderDefaults
}

export function getVideoProviderUiConfig(providerType: string): VideoProviderUiConfig {
  switch (providerType) {
    case 'toapis-video': {
      // provider 级配置面向多模型:展示各模型档案的并集,逐模型合法性由 model-profiles 在生成时校验。
      const union = unionOfKnownProfiles()
      return {
        supportedModes: [
          { value: 'text-to-video', label: '文生视频' },
          { value: 'image-to-video', label: '图生视频' },
          { value: 'reference-to-video', label: '参考素材生成' },
          { value: 'video-edit', label: '视频编辑' },
        ],
        supportedAspectRatios: union.aspectRatios,
        supportedResolutions: ['720P', '1080P'],
        supportedDurations: union.durations,
        maxReferenceImages: union.maxReferenceImages,
        maxReferenceVideos: 1,
        hint: 'ToAPIs 视频任务会先提交异步任务，再轮询结果并下载到本地素材库。'
          + '时长按模型不同：wan2.6 / wan2.6-flash 支持 5/10/15 秒，gemini_omni_flash 支持 4/6/10 秒。'
          + 'wan2.6-flash 需要参考图或参考视频（二选一），纯文生视频请改用 wan2.6 / gemini_omni_flash。',
      }
    }
    default:
      return {
        supportedModes: [{ value: 'text-to-video', label: '文生视频' }],
        supportedAspectRatios: ['16:9', '9:16'],
        supportedResolutions: ['720P'],
        supportedDurations: [5],
        maxReferenceImages: 1,
        maxReferenceVideos: 1,
      }
  }
}
