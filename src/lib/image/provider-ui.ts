import type { ProviderOptionsSchema } from './types'

export interface ImageProviderUiConfig {
  supportedAspectRatios: string[]
  supportedResolutions: string[]
  maxCount: number
  maxReferenceImages: number
  hint?: string
  advancedOptions: ProviderOptionsSchema
}

const DEFAULT_ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9',
]

const TOAPIS_ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9',
  '1:4', '4:1', '1:8', '8:1',
]

const DEFAULT_RESOLUTIONS = ['1K', '2K', '4K']

export function getImageProviderUiConfig(
  providerType: string,
  advancedOptions: ProviderOptionsSchema = {},
): ImageProviderUiConfig {
  switch (providerType) {
    case 'toapis-image':
      return {
        supportedAspectRatios: TOAPIS_ASPECT_RATIOS,
        supportedResolutions: DEFAULT_RESOLUTIONS,
        maxCount: 4,
        maxReferenceImages: 14,
        hint: '当前服务商支持极端宽高比、最多 14 张参考图，以及异步高耗时生成任务。',
        advancedOptions: {},
      }
    case 'dashscope':
      return {
        supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
        supportedResolutions: DEFAULT_RESOLUTIONS,
        maxCount: 4,
        maxReferenceImages: 10,
        hint: '当前服务商更适合电商图像编辑、一致性组图和区域编辑。',
        advancedOptions,
      }
    case 'volcengine':
      return {
        supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
        supportedResolutions: DEFAULT_RESOLUTIONS,
        maxCount: 4,
        maxReferenceImages: 4,
        hint: '当前服务商适合快速文生图，参数面板以生成质量和基础分辨率为主。',
        advancedOptions,
      }
    case 'gemini-image':
      return {
        supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
        supportedResolutions: DEFAULT_RESOLUTIONS,
        maxCount: 4,
        maxReferenceImages: 10,
        hint: '当前服务商走 Google 官方 Gemini 图片接口，适合通用对话式改图。',
        advancedOptions,
      }
    case 'midjourney':
      return {
        supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
        supportedResolutions: DEFAULT_RESOLUTIONS,
        // MJ 一次固定出 2×2 四宫格候选，数量设置对它不生效
        maxCount: 4,
        maxReferenceImages: 5,
        hint:
          'Midjourney 一次固定出 4 张候选（数量设置不生效），出图后可在对话里让 AI 放大、'
          + '局部重绘、抠图或转视频。注意：用本地图垫图时需要先上传，每张未缓存的图会额外消耗一次任务额度。',
        advancedOptions,
      }
    default:
      return {
        supportedAspectRatios: DEFAULT_ASPECT_RATIOS,
        supportedResolutions: DEFAULT_RESOLUTIONS,
        maxCount: 4,
        maxReferenceImages: 4,
        advancedOptions,
      }
  }
}
