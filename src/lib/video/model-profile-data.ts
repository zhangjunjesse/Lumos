import type { VideoModelProfile } from './model-profiles'

/**
 * ToAPIs 各视频模型参数档案数据 — 逐条对照 docs.toapis.com/docs/cn/api-reference/videos/<家族>/generation 录入。
 * 铁律:不编。每个字段都来自官方文档;文档没写清楚的能力(如 kling omni 的占位符参考图协议)宁可
 * 标记为不支持并在报错里指路,也不猜请求格式(size/duration 猜错过一次,线上 100% 失败)。
 */

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

const KLING_MODE = {
  field: 'mode' as const,
  values: ['720P', '1080P'],
  map: { '720P': 'std', '1080P': 'pro' },
}

export const VIDEO_MODEL_PROFILES: Record<string, VideoModelProfile> = {
  // ---- Wan（阿里万相） ----
  'wan2.6': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolution: { values: ['720p', '1080p'] },
    durations: [5, 10, 15],
    defaultDuration: 5,
    imageRef: { field: 'image_urls', max: 1 },
    videoRef: 'wan-metadata',
    supportsTextToVideo: true,
  },
  'wan2.6-flash': {
    aspectRatios: [],
    resolution: { values: ['720p', '1080p'] },
    durations: [5, 10, 15],
    defaultDuration: 5,
    imageRef: { field: 'image_urls', max: 1 },
    videoRef: 'wan-metadata',
    supportsTextToVideo: false,
    imageAndVideoRefsExclusive: true,
  },

  // ---- Gemini Omni ----
  gemini_omni_flash: {
    aspectRatios: ['16:9', '9:16'],
    resolution: { values: ['720P', '1080p'] },
    durations: [4, 6, 10],
    defaultDuration: 6,
    imageRef: { field: 'image_urls', max: 3 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  gemini_omni: {
    aspectRatios: ['16:9', '9:16'],
    resolution: { values: ['720P', '1080p'] },
    durations: [4, 6, 10],
    defaultDuration: 6,
    imageRef: { field: 'image_urls', max: 3 },
    videoRef: null,
    supportsTextToVideo: true,
  },

  // ---- Sora 2 ----
  'sora-2-official': {
    aspectRatios: ['16:9', '9:16'],
    resolution: null,
    durations: [4, 8, 12],
    defaultDuration: 4,
    imageRef: { field: 'image_urls', max: 1 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'sora-2-vvip': {
    aspectRatios: ['16:9', '9:16'],
    resolution: null,
    durations: [4, 8, 12],
    defaultDuration: 4,
    imageRef: { field: 'image_urls', max: 3 },
    videoRef: null,
    supportsTextToVideo: true,
  },

  // ---- Veo 3.1（逆向版:resolution 在 metadata,时长固定 8 秒） ----
  'veo3.1-fast': {
    aspectRatios: ['16:9', '9:16'],
    resolution: { values: ['720p', '1080p', '4k'], inMetadata: true },
    durations: [8],
    defaultDuration: 8,
    imageRef: { field: 'image_urls', max: 2 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'veo3.1-lite': {
    aspectRatios: ['16:9', '9:16'],
    resolution: { values: ['720p', '1080p', '4k'], inMetadata: true },
    durations: [8],
    defaultDuration: 8,
    imageRef: { field: 'image_urls', max: 2 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'veo3.1-quality': {
    aspectRatios: ['16:9', '9:16'],
    resolution: { values: ['720p', '1080p', '4k'], inMetadata: true },
    durations: [8],
    defaultDuration: 8,
    imageRef: { field: 'image_urls', max: 2 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'Veo3.1-fast-official': {
    aspectRatios: ['16:9', '9:16'],
    resolution: { values: ['720p', '1080p', '4k'] },
    durations: [4, 6, 8],
    defaultDuration: 8,
    imageRef: { field: 'image_urls', max: 1 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'Veo3.1-quality-official': {
    aspectRatios: ['16:9', '9:16'],
    resolution: { values: ['720p', '1080p', '4k'] },
    durations: [4, 6, 8],
    defaultDuration: 8,
    imageRef: { field: 'image_urls', max: 1 },
    videoRef: null,
    supportsTextToVideo: true,
  },

  // ---- MiniMax 海螺（无 aspect_ratio 参数,由参考图/分辨率决定） ----
  'MiniMax-Hailuo-02': {
    aspectRatios: [],
    resolution: { values: ['512P', '768P', '1080P'] },
    durations: [6, 10],
    defaultDuration: 6,
    imageRef: { field: 'image_urls', max: 1 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'MiniMax-Hailuo-2.3': {
    aspectRatios: [],
    resolution: { values: ['768P', '1080P'] },
    durations: [6, 10],
    defaultDuration: 6,
    imageRef: { field: 'image_urls', max: 1 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'MiniMax-Hailuo-2.3-Fast': {
    aspectRatios: [],
    resolution: { values: ['768P', '1080P'] },
    durations: [6, 10],
    defaultDuration: 6,
    imageRef: { field: 'image_urls', max: 1 },
    videoRef: null,
    // 文档只说 2.3(非 Fast)支持纯文生;Fast 按图生处理,报错会指路。
    supportsTextToVideo: false,
  },

  // ---- Vidu Q3 ----
  viduq3: {
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: { values: ['540p', '720p', '1080p'] },
    durations: range(3, 16),
    defaultDuration: 5,
    imageRef: { field: 'image_urls', max: 7 },
    videoRef: null,
    // 文档:纯文生用 viduq3-pro / viduq3-turbo;本体为参考图模型。
    supportsTextToVideo: false,
  },
  'viduq3-pro': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: { values: ['540p', '720p', '1080p'] },
    durations: range(1, 16),
    defaultDuration: 5,
    imageRef: { field: 'image_urls', max: 2 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'viduq3-turbo': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: { values: ['540p', '720p', '1080p'] },
    durations: range(1, 16),
    defaultDuration: 5,
    imageRef: { field: 'image_urls', max: 2 },
    videoRef: null,
    supportsTextToVideo: true,
  },

  // ---- Grok（duration 传字符串;参考图字段是 images） ----
  'grok-video-3': {
    aspectRatios: ['16:9', '9:16', '3:2', '2:3', '1:1'],
    resolution: { values: ['480p', '720p'] },
    durations: [6, 10, 15],
    defaultDuration: 10,
    durationAsString: true,
    imageRef: { field: 'images', max: 3 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'grok-video-1.5-preview': {
    aspectRatios: ['16:9', '9:16'],
    resolution: null,
    durations: [10, 15],
    defaultDuration: 10,
    durationAsString: true,
    imageRef: { field: 'images', max: 1 },
    videoRef: null,
    supportsTextToVideo: false,
  },

  // ---- 可灵 Kling ----
  'kling-v2-6': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: KLING_MODE,
    durations: [5, 10],
    defaultDuration: 5,
    imageRef: { field: 'reference_images', max: 4 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'kling-v3': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: KLING_MODE,
    durations: range(3, 15),
    defaultDuration: 5,
    imageRef: { field: 'reference_images', max: 4 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'kling-3.0-turbo': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: { values: ['720p', '1080p'] },
    durations: range(3, 15),
    defaultDuration: 5,
    imageRef: { field: 'reference_images', max: 1 },
    videoRef: null,
    supportsTextToVideo: true,
  },
  // omni / o1 的参考素材走 metadata.image_list + <<<image_N>>> 占位符协议,未接入;先只开放文生。
  'kling-v3-omni': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: KLING_MODE,
    durations: range(3, 15),
    defaultDuration: 5,
    imageRef: null,
    videoRef: null,
    supportsTextToVideo: true,
  },
  'kling-video-o1': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: KLING_MODE,
    durations: range(3, 10),
    defaultDuration: 5,
    imageRef: null,
    videoRef: null,
    supportsTextToVideo: true,
  },

  // ---- Seedance 2（角色数组协议） ----
  'seedance-2': {
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolution: { values: ['480p', '720p', '1080p', '4k'] },
    durations: range(4, 15),
    defaultDuration: 5,
    imageRef: { field: 'image_with_roles', max: 9, roles: ['reference_image'] },
    videoRef: 'video_with_roles',
    supportsTextToVideo: true,
  },
  'seedance-2-fast': {
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolution: { values: ['480p', '720p'] },
    durations: range(4, 15),
    defaultDuration: 5,
    imageRef: { field: 'image_with_roles', max: 9, roles: ['reference_image'] },
    videoRef: 'video_with_roles',
    supportsTextToVideo: true,
  },
  'seedance-2-mini': {
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolution: { values: ['480p', '720p'] },
    durations: range(4, 15),
    defaultDuration: 5,
    imageRef: { field: 'image_with_roles', max: 9, roles: ['reference_image'] },
    videoRef: 'video_with_roles',
    supportsTextToVideo: true,
  },

  // ---- 豆包 Seedance ----
  'doubao-seedance-1-0-pro-fast': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolution: { values: ['480p', '720p', '1080p'] },
    durations: range(2, 12),
    defaultDuration: 5,
    imageRef: { field: 'image_with_roles', max: 1, roles: ['reference'] },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'doubao-seedance-1-0-pro-quality': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolution: { values: ['480p', '720p', '1080p'] },
    durations: range(2, 12),
    defaultDuration: 5,
    imageRef: { field: 'image_with_roles', max: 1, roles: ['reference'] },
    videoRef: null,
    supportsTextToVideo: true,
  },
  'doubao-seedance-1-5-pro': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolution: { values: ['480p', '720p', '1080p'], inMetadata: true },
    durations: range(4, 12),
    defaultDuration: 5,
    // 1.5 Pro 只认首/尾帧角色,不支持普通参考图。
    imageRef: { field: 'image_with_roles', max: 2, roles: ['first_frame', 'last_frame'] },
    videoRef: null,
    supportsTextToVideo: true,
  },

  // ---- HappyHorse（带 action 字段;视频编辑传顶层 url） ----
  'happyhorse-1.1': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolution: { values: ['720P', '1080P'] },
    durations: range(3, 15),
    defaultDuration: 5,
    imageRef: { field: 'reference_images', max: 9 },
    videoRef: 'happyhorse-url',
    supportsTextToVideo: true,
    actionField: true,
  },
}
