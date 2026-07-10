/**
 * ToAPIs 各视频模型的请求参数档案 — 单一真源。
 * 生成(generate.ts)、计费(video-gen-billing)、UI 配置(provider-ui)都从这里取值,
 * 避免"客户端约束"与"真实 API 合法值"漂移(曾把 size/duration 写错导致 100% 提交失败)。
 * 档案数据按官方文档逐条录入,见 ./model-profile-data.ts。
 */

import { VIDEO_MODEL_PROFILES } from './model-profile-data'

export interface VideoModelProfile {
  /** 可发送的 aspect_ratio 值;空数组 = 该模型不接受此参数(由参考素材/分辨率决定)。 */
  aspectRatios: string[]
  /**
   * 分辨率参数投放方式;null = 该模型不接受分辨率参数。
   * - values: 用户可选值(原样大小写),输入按大小写不敏感匹配
   * - field: 请求字段名,默认 'resolution';kling 系用 'mode'
   * - map: 匹配后再映射(如 720P→std)
   * - inMetadata: veo3.1 逆向版 / 豆包 1.5 把 resolution 放 metadata 里
   */
  resolution: {
    values: string[]
    field?: 'resolution' | 'mode'
    map?: Record<string, string>
    inMetadata?: boolean
  } | null
  /** 合法 duration 秒数;空数组 = 未知模型,不做客户端校验。 */
  durations: number[]
  defaultDuration: number
  /** grok 系:duration 在请求体里必须是字符串。计费仍按数字秒。 */
  durationAsString?: boolean
  /**
   * 参考图投放方式;null = 该模型参考图协议未接入(只开放文生),传参考图会得到明确报错。
   * roles: image_with_roles 协议按序取角色,超出取最后一个(如 ['first_frame','last_frame'])。
   */
  imageRef: {
    field: 'image_urls' | 'reference_images' | 'images' | 'image_with_roles'
    max: number
    roles?: string[]
  } | null
  /** 参考视频投放方式;null = 不支持。 */
  videoRef: 'wan-metadata' | 'video_with_roles' | 'happyhorse-url' | null
  supportsTextToVideo: boolean
  /** wan2.6-flash: image_urls 与 metadata.reference_urls 不可同时使用。 */
  imageAndVideoRefsExclusive?: boolean
  /** happyhorse: 请求体带 action 字段(text-to-video / reference-to-video / video-edit)。 */
  actionField?: boolean
}

/** 未知模型:透传、不做客户端校验,把判断权交给服务端。 */
const PASSTHROUGH_PROFILE: VideoModelProfile = {
  aspectRatios: ['16:9', '9:16'],
  resolution: null,
  durations: [],
  defaultDuration: 5,
  imageRef: { field: 'image_urls', max: 4 },
  videoRef: 'wan-metadata',
  supportsTextToVideo: true,
}

export function getVideoModelProfile(model: string): VideoModelProfile {
  return VIDEO_MODEL_PROFILES[model] ?? PASSTHROUGH_PROFILE
}

export function isKnownVideoModel(model: string): boolean {
  return Boolean(VIDEO_MODEL_PROFILES[model])
}

export function listKnownVideoModels(): string[] {
  return Object.keys(VIDEO_MODEL_PROFILES)
}

/**
 * 输入大小写不敏感匹配 → API 期望的原样值(经 map 映射);
 * 不合法返回 undefined,由调用方决定报错或忽略。
 */
export function resolveResolutionParam(
  profile: VideoModelProfile,
  input: string,
): { field: 'resolution' | 'mode'; value: string; inMetadata: boolean } | undefined {
  if (!profile.resolution || !input.trim()) return undefined
  const normalized = input.trim().toLowerCase()
  const matched = profile.resolution.values.find(value => value.toLowerCase() === normalized)
  if (!matched) return undefined
  return {
    field: profile.resolution.field ?? 'resolution',
    value: profile.resolution.map?.[matched] ?? matched,
    inMetadata: profile.resolution.inMetadata ?? false,
  }
}

export function validateVideoDuration(
  model: string,
  seconds: number,
): { ok: true } | { ok: false; error: string } {
  const profile = getVideoModelProfile(model)
  if (profile.durations.length === 0 || profile.durations.includes(seconds)) return { ok: true }
  return {
    ok: false,
    error: `模型 ${model} 不支持 ${seconds} 秒时长,合法值: ${formatDurations(profile.durations)} 秒。`,
  }
}

/** 连续区间压缩显示(3-15),离散值逐个列(4/6/10)。 */
export function formatDurations(durations: number[]): string {
  if (durations.length === 0) return '任意'
  const sorted = [...durations].sort((a, b) => a - b)
  const isContiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1)
  if (isContiguous && sorted.length > 3) return `${sorted[0]}-${sorted[sorted.length - 1]}`
  return sorted.join('/')
}

/** UI 层聚合(provider 级配置面向多模型):取各已知模型的并集。 */
export function unionOfKnownProfiles(): {
  aspectRatios: string[]
  resolutions: string[]
  durations: number[]
  maxReferenceImages: number
} {
  const aspectRatios = new Set<string>()
  const resolutionsUpper = new Set<string>()
  const durations = new Set<number>()
  let maxReferenceImages = 1
  for (const profile of Object.values(VIDEO_MODEL_PROFILES)) {
    profile.aspectRatios.forEach(v => aspectRatios.add(v))
    profile.resolution?.values.forEach(v => resolutionsUpper.add(v.toUpperCase()))
    profile.durations.forEach(v => durations.add(v))
    if (profile.imageRef) maxReferenceImages = Math.max(maxReferenceImages, profile.imageRef.max)
  }
  return {
    aspectRatios: [...aspectRatios],
    resolutions: [...resolutionsUpper].sort(),
    durations: [...durations].sort((a, b) => a - b),
    maxReferenceImages,
  }
}
