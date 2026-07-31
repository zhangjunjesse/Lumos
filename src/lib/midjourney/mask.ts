/**
 * 局部重绘蒙版生成。
 *
 * MJ 的 modal 接口要一张黑白 PNG：白色 = 重绘这块，黑色 = 原样保留。
 * Agent 画不出像素图，所以对外只暴露「相对区域」——用 0-1 的比例描述
 * 「头顶那块」「下半部分」，由这里换算成实际像素并合成蒙版。
 */

import sharp from 'sharp'
import { ImageGenError } from '@/lib/image/types'

/** 区域用 0-1 相对比例表示，与图片实际分辨率解耦。 */
export interface MaskRegion {
  x: number
  y: number
  width: number
  height: number
}

function assertValidRegion(region: MaskRegion, index: number): void {
  const values = [region.x, region.y, region.width, region.height]
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new ImageGenError('invalid_params', `蒙版区域 #${index} 含非法数值`, false)
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new ImageGenError('invalid_params', `蒙版区域 #${index} 的宽高必须大于 0`, false)
  }
  // 容差 1e-6：0.1 + 0.9 在浮点下是 1.0000000000000002，严格比较会把合法区域判成越界
  const EPSILON = 1e-6
  if (
    region.x < -EPSILON || region.y < -EPSILON
    || region.x + region.width > 1 + EPSILON
    || region.y + region.height > 1 + EPSILON
  ) {
    throw new ImageGenError(
      'invalid_params',
      `蒙版区域 #${index} 超出画面范围（x/y/width/height 都应是 0-1 的比例）`,
      false,
    )
  }
}

/**
 * 按相对区域生成蒙版，返回可直接塞给 modal 的 data URI。
 * 多个区域会合并到同一张蒙版上（MJ 支持一次重绘多块）。
 */
export async function buildInpaintMask(
  imageWidth: number,
  imageHeight: number,
  regions: MaskRegion[],
): Promise<string> {
  if (!regions.length) {
    throw new ImageGenError('invalid_params', '局部重绘至少需要一个区域', false)
  }
  regions.forEach(assertValidRegion)

  const overlays = await Promise.all(
    regions.map(async (region) => {
      // 先定左上角，再用「到边界还剩多少」夹住宽高：分别 round 会让
      // left+width 超出画布一两个像素，sharp 直接抛 extract_area 错误。
      const left = Math.min(Math.round(region.x * imageWidth), imageWidth - 1)
      const top = Math.min(Math.round(region.y * imageHeight), imageHeight - 1)
      const width = Math.max(1, Math.min(Math.round(region.width * imageWidth), imageWidth - left))
      const height = Math.max(1, Math.min(Math.round(region.height * imageHeight), imageHeight - top))

      return {
        input: await sharp({
          create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
        }).png().toBuffer(),
        left,
        top,
      }
    }),
  )

  const mask = await sharp({
    create: {
      width: imageWidth,
      height: imageHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer()

  return `data:image/png;base64,${mask.toString('base64')}`
}
