/**
 * ToAPIs 各视频模型的请求参数档案 — 单一真源。
 * 生成(generate.ts)、计费(video-gen-billing)、UI 配置(provider-ui)都从这里取值,
 * 避免"客户端约束"与"真实 API 合法值"漂移(曾把 size/duration 写错导致 100% 提交失败)。
 *
 * 依据官方文档 docs.toapis.com/docs/cn/api-reference/videos/<model>/generation:
 * - wan2.6:            aspect_ratio 16:9/9:16/1:1/4:3/3:4;resolution 720p/1080p(小写);duration 5/10/15;image_urls ≤1;metadata.reference_urls 支持
 * - wan2.6-flash:      不接受 aspect_ratio(由参考素材决定);duration 5/10/15;image_urls 与 metadata.reference_urls 二选一;不支持纯文生视频
 * - gemini_omni_flash: aspect_ratio 16:9/9:16;resolution 720P/1080p(原样大小写);duration 4/6/10;image_urls ≤3;无参考视频
 */

export interface VideoModelProfile {
  /** 可发送的 aspect_ratio 值;空数组 = 该模型不接受此参数。 */
  aspectRatios: string[]
  /** API 期望的 resolution 原样值(大小写敏感),输入按大小写不敏感匹配。空数组 = 不发送。 */
  resolutions: string[]
  /** 合法 duration 秒数;空数组 = 未知模型,不做客户端校验。 */
  durations: number[]
  defaultDuration: number
  maxReferenceImages: number
  supportsVideoRefs: boolean
  supportsTextToVideo: boolean
  /** wan2.6-flash: image_urls 与 metadata.reference_urls 不可同时使用。 */
  imageAndVideoRefsExclusive: boolean
}

const PROFILES: Record<string, VideoModelProfile> = {
  'wan2.6': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutions: ['720p', '1080p'],
    durations: [5, 10, 15],
    defaultDuration: 5,
    maxReferenceImages: 1,
    supportsVideoRefs: true,
    supportsTextToVideo: true,
    imageAndVideoRefsExclusive: false,
  },
  'wan2.6-flash': {
    aspectRatios: [],
    resolutions: ['720p', '1080p'],
    durations: [5, 10, 15],
    defaultDuration: 5,
    maxReferenceImages: 1,
    supportsVideoRefs: true,
    supportsTextToVideo: false,
    imageAndVideoRefsExclusive: true,
  },
  gemini_omni_flash: {
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720P', '1080p'],
    durations: [4, 6, 10],
    defaultDuration: 6,
    maxReferenceImages: 3,
    supportsVideoRefs: false,
    supportsTextToVideo: true,
    imageAndVideoRefsExclusive: false,
  },
}

/** 未知模型:全部透传、不做客户端校验,把判断权交给服务端。 */
const PASSTHROUGH_PROFILE: VideoModelProfile = {
  aspectRatios: ['16:9', '9:16'],
  resolutions: [],
  durations: [],
  defaultDuration: 5,
  maxReferenceImages: 4,
  supportsVideoRefs: true,
  supportsTextToVideo: true,
  imageAndVideoRefsExclusive: false,
}

export function getVideoModelProfile(model: string): VideoModelProfile {
  return PROFILES[model] ?? PASSTHROUGH_PROFILE
}

export function isKnownVideoModel(model: string): boolean {
  return Boolean(PROFILES[model])
}

/** 输入大小写不敏感 → API 期望的原样值;不合法返回 undefined。 */
export function resolveResolutionParam(profile: VideoModelProfile, input: string): string | undefined {
  if (profile.resolutions.length === 0) return input || undefined
  const normalized = input.trim().toLowerCase()
  return profile.resolutions.find(value => value.toLowerCase() === normalized)
}

export function validateVideoDuration(
  model: string,
  seconds: number,
): { ok: true } | { ok: false; error: string } {
  const profile = getVideoModelProfile(model)
  if (profile.durations.length === 0 || profile.durations.includes(seconds)) return { ok: true }
  return {
    ok: false,
    error: `模型 ${model} 不支持 ${seconds} 秒时长,合法值: ${profile.durations.join('/')} 秒。`,
  }
}

/** UI 层聚合(provider 级配置面向多模型):取各已知模型的并集。 */
export function unionOfKnownProfiles(): {
  aspectRatios: string[]
  durations: number[]
  maxReferenceImages: number
} {
  const aspectRatios = new Set<string>()
  const durations = new Set<number>()
  let maxReferenceImages = 1
  for (const profile of Object.values(PROFILES)) {
    profile.aspectRatios.forEach(v => aspectRatios.add(v))
    profile.durations.forEach(v => durations.add(v))
    maxReferenceImages = Math.max(maxReferenceImages, profile.maxReferenceImages)
  }
  return {
    aspectRatios: [...aspectRatios],
    durations: [...durations].sort((a, b) => a - b),
    maxReferenceImages,
  }
}
