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
        supportedResolutions: union.resolutions,
        supportedDurations: union.durations,
        maxReferenceImages: union.maxReferenceImages,
        maxReferenceVideos: 1,
        hint: 'ToAPIs 视频任务会先提交异步任务，再轮询结果并下载到本地素材库。'
          + '时长/宽高比/分辨率的合法值随模型不同（如 wan2.6 支持 5/10/15 秒、sora-2 支持 4/8/12 秒），'
          + '传了不支持的值会返回列出合法值的报错。wan2.6-flash 等模型需要参考素材，纯文生视频请选支持的模型。',
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
