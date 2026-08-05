/**
 * 垫图上传 — 把本地图片变成 MJ 能读到的公网 URL。
 *
 * MJ 的 imagine 只认 URL，不吃 base64，所以本地参考图要先上传换成地址。
 * 走 proxy 的正规上传接口 upload-discord-images：同步返回、不产生绘图任务、不花钱。
 *
 * 历史包袱：早期对接的中转网关没开这个接口，曾用 describe 顶替上传，但 describe
 * 是一次收费绘图任务、且部分部署里走的是被 Discord 拒的旧版斜杠命令（BadRequest）。
 * 已弃用那条路。按内容哈希缓存 URL——同一张商品图反复垫图不必反复上传。
 */

import crypto from 'crypto'
import fs from 'fs'
import type { ImageInput } from '@/lib/image/types'
import { ImageGenError } from '@/lib/image/types'
import type { MidjourneyClient } from './client'

/** 进程内缓存：内容哈希 → 公网 URL。上传返回的地址稳定，可长期复用。 */
const urlCache = new Map<string, string>()

function readImageBytes(image: ImageInput): { bytes: Buffer; mimeType: string } {
  if (image.type === 'path') {
    return { bytes: fs.readFileSync(image.filePath), mimeType: 'image/png' }
  }
  if (image.type === 'base64') {
    return { bytes: Buffer.from(image.data, 'base64'), mimeType: image.mimeType || 'image/png' }
  }
  throw new ImageGenError('invalid_params', `不支持的参考图类型: ${(image as { type: string }).type}`, false)
}

/** data URI 形式的内容 + 缓存 key。 */
function toDataUri(image: ImageInput): { dataUri: string; hash: string } {
  const { bytes, mimeType } = readImageBytes(image)
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  return { dataUri: `data:${mimeType};base64,${bytes.toString('base64')}`, hash }
}

/**
 * 把参考图统一成公网 URL。已经是 http(s) 的直接用；本地图批量上传一次拿回全部地址。
 * 命中缓存的图不重复上传。
 */
export async function resolveReferenceUrls(
  client: MidjourneyClient,
  images: ImageInput[] | undefined,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!images?.length) return []

  // 先按位置占位，本地图收集起来一次性批量上传，减少往返
  const results: (string | null)[] = new Array(images.length).fill(null)
  const toUpload: Array<{ index: number; hash: string; dataUri: string }> = []

  images.forEach((image, index) => {
    if (image.type === 'url' && /^https?:\/\//i.test(image.url)) {
      results[index] = image.url
      return
    }
    const { dataUri, hash } = toDataUri(image)
    const cached = urlCache.get(hash)
    if (cached) {
      results[index] = cached
    } else {
      toUpload.push({ index, hash, dataUri })
    }
  })

  if (toUpload.length > 0) {
    const uploaded = await client.uploadImages(toUpload.map((u) => u.dataUri), signal)
    if (uploaded.length !== toUpload.length) {
      throw new ImageGenError(
        'provider_unavailable',
        `Midjourney 参考图上传数量不符：传了 ${toUpload.length} 张，返回 ${uploaded.length} 个地址`,
        false,
      )
    }
    toUpload.forEach((u, i) => {
      urlCache.set(u.hash, uploaded[i])
      results[u.index] = uploaded[i]
    })
  }

  return results.map((url, index) => {
    if (!url) throw new ImageGenError('provider_unavailable', `第 ${index + 1} 张参考图未能取得地址`, false)
    return url
  })
}

/** 仅供测试重置缓存。 */
export function clearReferenceUrlCache(): void {
  urlCache.clear()
}
