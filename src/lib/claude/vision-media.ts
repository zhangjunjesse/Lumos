// Anthropic vision 接受的 media_type。SDK 0.3.x 起 image block 的 media_type
// 是字面量联合类型,所有喂给 SDK 的图片块都必须收敛到这四类,不允许裸 string。
export const VISION_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export type VisionMediaType = (typeof VISION_MEDIA_TYPES)[number]

export function isVisionMediaType(value: unknown): value is VisionMediaType {
  return typeof value === 'string' && (VISION_MEDIA_TYPES as readonly string[]).includes(value)
}

export function toVisionMediaType(
  value: string | undefined,
  fallback: VisionMediaType = 'image/png',
): VisionMediaType {
  return isVisionMediaType(value) ? value : fallback
}
