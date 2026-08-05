// 参考图上传回归：走 upload-discord-images 批量上传 + 内容哈希缓存。
// 这条路替代了旧的 describe 上传(describe 是收费绘图任务,且旧版斜杠命令会被 Discord 拒)。

import { resolveReferenceUrls, clearReferenceUrlCache } from '../reference'
import type { MidjourneyClient } from '../client'

function fakeClient(uploadImpl: (arr: string[]) => Promise<string[]>) {
  return { uploadImages: jest.fn(uploadImpl) } as unknown as MidjourneyClient & { uploadImages: jest.Mock }
}

beforeEach(() => clearReferenceUrlCache())

describe('resolveReferenceUrls', () => {
  test('本地 base64 图走批量上传，返回顺序与输入一致', async () => {
    const client = fakeClient(async (arr) => arr.map((_, i) => `https://cdn.test/u${i}.png`))
    const urls = await resolveReferenceUrls(client, [
      { type: 'base64', data: Buffer.from('a').toString('base64'), mimeType: 'image/png' },
      { type: 'base64', data: Buffer.from('b').toString('base64'), mimeType: 'image/png' },
    ])
    expect(urls).toEqual(['https://cdn.test/u0.png', 'https://cdn.test/u1.png'])
    expect((client as unknown as { uploadImages: jest.Mock }).uploadImages).toHaveBeenCalledTimes(1)
  })

  test('已是 http(s) 的参考图直接用，不上传', async () => {
    const client = fakeClient(async () => { throw new Error('不该被调用') })
    const urls = await resolveReferenceUrls(client, [{ type: 'url', url: 'https://x/a.png' }])
    expect(urls).toEqual(['https://x/a.png'])
    expect((client as unknown as { uploadImages: jest.Mock }).uploadImages).not.toHaveBeenCalled()
  })

  test('混合输入：URL 占位不变，只有本地图进上传批次，最终顺序正确', async () => {
    const client = fakeClient(async (arr) => arr.map((_, i) => `https://cdn.test/up${i}.png`))
    const urls = await resolveReferenceUrls(client, [
      { type: 'url', url: 'https://x/keep.png' },
      { type: 'base64', data: Buffer.from('local').toString('base64'), mimeType: 'image/png' },
    ])
    expect(urls).toEqual(['https://x/keep.png', 'https://cdn.test/up0.png'])
  })

  test('同一张图第二次命中缓存，不重复上传', async () => {
    const client = fakeClient(async (arr) => arr.map(() => 'https://cdn.test/same.png'))
    const img = { type: 'base64' as const, data: Buffer.from('dup').toString('base64'), mimeType: 'image/png' }
    await resolveReferenceUrls(client, [img])
    const again = await resolveReferenceUrls(client, [img])
    expect(again).toEqual(['https://cdn.test/same.png'])
    expect((client as unknown as { uploadImages: jest.Mock }).uploadImages).toHaveBeenCalledTimes(1)
  })

  test('上传返回数量与请求不符要报错，不能静默错位', async () => {
    const client = fakeClient(async () => ['only-one'])
    await expect(resolveReferenceUrls(client, [
      { type: 'base64', data: Buffer.from('x').toString('base64'), mimeType: 'image/png' },
      { type: 'base64', data: Buffer.from('y').toString('base64'), mimeType: 'image/png' },
    ])).rejects.toThrow(/数量不符/)
  })

  test('空输入返回空数组，不触碰上传', async () => {
    const client = fakeClient(async () => { throw new Error('不该被调用') })
    expect(await resolveReferenceUrls(client, [])).toEqual([])
    expect(await resolveReferenceUrls(client, undefined)).toEqual([])
  })
})
