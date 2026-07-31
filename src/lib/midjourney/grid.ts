/**
 * 四宫格拆分。
 *
 * MJ 一次出的是 2×2 拼图，不是 4 张独立图。这里在本地切开，
 * 而不是调 action 的 U 按钮——实测 v7 的 U 按钮既不提升分辨率
 * （四宫格 1792×2688，U 出来仍是 896×1344，正好是单格尺寸），
 * 每次还要收一份任务钱。U 的唯一价值是解锁单图态的后续操作。
 *
 * 切分顺序必须与 U1-U4 严格一致：左上=1 右上=2 左下=3 右下=4。
 * 错位会导致用户选中的图和后续操作的图不是同一张。
 */

import sharp from 'sharp'
import { ImageGenError } from '@/lib/image/types'

export interface GridCell {
  /** 1-4，与 MJ 的 U1-U4 / V1-V4 编号对应 */
  index: number
  buffer: Buffer
}

export async function splitGrid(grid: Buffer): Promise<GridCell[]> {
  const { width, height } = await sharp(grid).metadata()
  if (!width || !height) {
    throw new ImageGenError('unknown', 'Midjourney 出图无法解析尺寸', false)
  }

  const cellWidth = Math.floor(width / 2)
  const cellHeight = Math.floor(height / 2)
  const positions = [
    { left: 0, top: 0 },
    { left: cellWidth, top: 0 },
    { left: 0, top: cellHeight },
    { left: cellWidth, top: cellHeight },
  ]

  return Promise.all(
    positions.map(async (position, i) => ({
      index: i + 1,
      buffer: await sharp(grid)
        .extract({ ...position, width: cellWidth, height: cellHeight })
        .png()
        .toBuffer(),
    })),
  )
}
