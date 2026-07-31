// 蒙版生成回归。蒙版画错等于重绘错地方，而每次重绘都是真金白银。

import sharp from 'sharp'
import { buildInpaintMask } from '../mask'
import { ImageGenError } from '@/lib/image/types'

async function pixelAt(dataUri: string, x: number, y: number): Promise<[number, number, number]> {
  const buffer = Buffer.from(dataUri.split(',')[1], 'base64')
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return [data[offset], data[offset + 1], data[offset + 2]]
}

describe('buildInpaintMask', () => {
  test('框内为白（重绘）、框外为黑（保留原样）', async () => {
    // 顶部 40%：头部区域重绘，脸和身体不动
    const mask = await buildInpaintMask(100, 200, [{ x: 0, y: 0, width: 1, height: 0.4 }])

    expect(await pixelAt(mask, 50, 20)).toEqual([255, 255, 255])  // y=20 在顶部 80px 内
    expect(await pixelAt(mask, 50, 150)).toEqual([0, 0, 0])       // y=150 在框外
  })

  test('尺寸与原图一致', async () => {
    const mask = await buildInpaintMask(128, 256, [{ x: 0, y: 0, width: 0.5, height: 0.5 }])
    const meta = await sharp(Buffer.from(mask.split(',')[1], 'base64')).metadata()
    expect(meta.width).toBe(128)
    expect(meta.height).toBe(256)
  })

  test('多个区域合并到同一张蒙版', async () => {
    const mask = await buildInpaintMask(100, 100, [
      { x: 0, y: 0, width: 0.2, height: 0.2 },
      { x: 0.8, y: 0.8, width: 0.2, height: 0.2 },
    ])
    expect(await pixelAt(mask, 5, 5)).toEqual([255, 255, 255])
    expect(await pixelAt(mask, 95, 95)).toEqual([255, 255, 255])
    expect(await pixelAt(mask, 50, 50)).toEqual([0, 0, 0])
  })

  test('贴边区域不能被浮点误差判成越界，也不能让 sharp 因越界抛错', async () => {
    // 0.1 + 0.9 在浮点下是 1.0000000000000002，严格比较会误判越界
    await expect(buildInpaintMask(100, 100, [{ x: 0.1, y: 0.1, width: 0.9, height: 0.9 }]))
      .resolves.toBeTruthy()
    // 右下角贴边：分别 round 会让 left+width 超出画布，sharp 会抛 extract_area
    const mask = await buildInpaintMask(101, 101, [{ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }])
    const meta = await sharp(Buffer.from(mask.split(',')[1], 'base64')).metadata()
    expect(meta.width).toBe(101)
  })

  test('区域超出画面或为空要直接报错，不能静默裁剪', async () => {
    await expect(buildInpaintMask(100, 100, [])).rejects.toBeInstanceOf(ImageGenError)
    await expect(
      buildInpaintMask(100, 100, [{ x: 0.5, y: 0, width: 0.8, height: 0.5 }]),
    ).rejects.toThrow(/超出画面/)
    await expect(
      buildInpaintMask(100, 100, [{ x: 0, y: 0, width: 0, height: 0.5 }]),
    ).rejects.toThrow(/宽高必须大于 0/)
  })
})
