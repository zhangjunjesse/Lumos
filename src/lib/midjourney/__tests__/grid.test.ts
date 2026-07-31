// 四宫格切分回归。顺序错位是最危险的 bug：用户点"第 3 张"，实际操作到别的图上。

import sharp from 'sharp'
import { splitGrid } from '../grid'

/** 造一张 2×2 四色图：左上红、右上绿、左下蓝、右下白 */
async function makeGrid(): Promise<Buffer> {
  const cell = (r: number, g: number, b: number) =>
    sharp({ create: { width: 40, height: 60, channels: 3, background: { r, g, b } } }).png().toBuffer()

  return sharp({ create: { width: 80, height: 120, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: await cell(255, 0, 0), left: 0, top: 0 },
      { input: await cell(0, 255, 0), left: 40, top: 0 },
      { input: await cell(0, 0, 255), left: 0, top: 60 },
      { input: await cell(255, 255, 255), left: 40, top: 60 },
    ])
    .png()
    .toBuffer()
}

async function centerPixel(buffer: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  const x = Math.floor(info.width / 2)
  const y = Math.floor(info.height / 2)
  const offset = (y * info.width + x) * info.channels
  return [data[offset], data[offset + 1], data[offset + 2]]
}

describe('splitGrid', () => {
  test('切出 4 张，尺寸各为原图的四分之一', async () => {
    const cells = await splitGrid(await makeGrid())
    expect(cells).toHaveLength(4)
    for (const cell of cells) {
      const meta = await sharp(cell.buffer).metadata()
      expect(meta.width).toBe(40)
      expect(meta.height).toBe(60)
    }
  })

  test('序号严格对应 U1-U4：左上=1 右上=2 左下=3 右下=4', async () => {
    const cells = await splitGrid(await makeGrid())
    expect(cells.map((c) => c.index)).toEqual([1, 2, 3, 4])

    expect(await centerPixel(cells[0].buffer)).toEqual([255, 0, 0])     // U1 左上 红
    expect(await centerPixel(cells[1].buffer)).toEqual([0, 255, 0])     // U2 右上 绿
    expect(await centerPixel(cells[2].buffer)).toEqual([0, 0, 255])     // U3 左下 蓝
    expect(await centerPixel(cells[3].buffer)).toEqual([255, 255, 255]) // U4 右下 白
  })
})
