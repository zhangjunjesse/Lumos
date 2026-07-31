/**
 * Midjourney 真机链路验证。
 *
 * 默认跳过。要跑：MJ_LIVE_KEY=sk-xxx npx jest live.test.ts
 * 会真实提交任务并消耗服务商额度（每个任务约 ¥2），别在 CI 里开。
 *
 * 留在仓库里是因为这条链路的坑（假成功、四宫格、垫图必须先上传）都不是
 * mock 能覆盖的 —— 供应商行为变了只有真跑才知道。
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

const KEY = process.env.MJ_LIVE_KEY
const BASE_URL = process.env.MJ_LIVE_BASE_URL || 'https://api.huiyan-ai.cn'
const describeLive = KEY ? describe : describe.skip

describeLive('Midjourney 真机链路', () => {
  jest.setTimeout(20 * 60 * 1000)

  /** 第一个用例的产出，后面的选图 / 局部重绘复用它，省掉重复出图的费用。 */
  let generated: { taskId: string; buttons: unknown[]; base64List: string[] } | null = null

  beforeAll(async () => {
    // 所有落库操作都必须发生在临时目录，绝不碰用户真实的 ~/.lumos
    process.env.LUMOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-live-db-'))
    const { DB_PATH, getDb } = await import('@/lib/db/connection')
    if (!DB_PATH.includes('mj-live-db-')) {
      throw new Error(`拒绝在真实数据库上跑真机测试: ${DB_PATH}`)
    }
    const { initDb } = await import('@/lib/db/schema')
    initDb(getDb())
  })

  test('imagine 出图 → 本地切成 4 张候选 → 带回任务句柄', async () => {
    const { createMidjourneyProvider } = await import('../../image/providers/midjourney')
    const provider = createMidjourneyProvider({ apiKey: KEY!, baseUrl: BASE_URL })

    const phases: string[] = []
    const result = await provider.generate({
      prompt: 'a single ripe red apple on a plain white studio background, product photography',
      aspectRatio: '2:3',
      onProgress: (p) => { if (!phases.includes(p.phase)) phases.push(p.phase) },
    })

    // 四宫格必须被切开，而不是把拼图当成一张返回
    expect(result.images).toHaveLength(4)
    for (const img of result.images) {
      expect(img.mimeType).toBe('image/png')
      expect(img.base64.length).toBeGreaterThan(1000)
    }

    // 后续操作全靠这个句柄，缺了等于放大/局部重绘都做不了
    const ref = result.providerTaskRef as { provider?: string; taskId?: string; buttons?: unknown[] }
    expect(ref?.provider).toBe('midjourney')
    expect(ref?.taskId).toBeTruthy()
    expect(Array.isArray(ref?.buttons) && ref.buttons.length).toBeGreaterThan(0)

    expect(phases).toEqual(['submitting', 'polling', 'downloading'])

    // 落一份到临时目录方便肉眼确认切图顺序没错位
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-live-'))
    result.images.forEach((img, i) => {
      fs.writeFileSync(path.join(outDir, `cell-${i + 1}.png`), Buffer.from(img.base64, 'base64'))
    })
    console.log(`[live] 出图已保存到 ${outDir}，taskId=${ref.taskId}`)

    generated = {
      taskId: ref.taskId!,
      buttons: ref.buttons!,
      base64List: result.images.map((img) => img.base64),
    }
  })

  // 依赖上一个用例的产出（jest 同 describe 内顺序执行），单独 -t 跑会跳过
  test('选图进单图态 → 局部重绘只改框内，框外原样保留', async () => {
    if (!generated) {
      console.warn('[live] 跳过：需要先跑出图用例')
      return
    }

    const { saveBase64Images, createMediaRecord } = await import('@/lib/image/persist')
    const { pickImage, inpaint } = await import('../operations')
    const { MidjourneyClient } = await import('../client')

    // 还原一次「出图后落库」的现场：四张候选 + 任务句柄
    const saved = saveBase64Images(
      generated.base64List.map((base64) => ({ base64, mimeType: 'image/png' })),
    )
    createMediaRecord({
      type: 'image', status: 'completed', providerType: 'midjourney', model: 'mj-fast',
      prompt: 'live test', aspectRatio: '2:3', imageSize: '',
      localPath: saved[0].localPath,
      metadata: {
        imageCount: saved.length,
        imagePaths: saved.map((s) => s.localPath),
        providerTaskRef: {
          provider: 'midjourney',
          taskId: generated.taskId,
          buttons: generated.buttons,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        },
      },
    })

    const ctx = {
      client: new MidjourneyClient({ apiKey: KEY!, baseUrl: BASE_URL }),
      providerType: 'midjourney',
      model: 'mj-fast',
    }

    // 1) 选中第 1 张。四宫格任务上只有 U/V，选完才解锁后续操作
    const picked = await pickImage(ctx, { imagePath: saved[0].localPath }, 1)
    expect(picked.images).toHaveLength(1)
    console.log(`[live] 选图完成 taskId=${picked.taskId} → ${picked.images[0].path}`)

    // 2) 局部重绘：只框顶部 35%，画面下方必须逐像素不变
    const before = fs.readFileSync(picked.images[0].path)
    const repainted = await inpaint(
      ctx,
      { imagePath: picked.images[0].path },
      [{ x: 0, y: 0, width: 1, height: 0.35 }],
      'a bunch of green grapes',
    )
    expect(repainted.images).toHaveLength(4) // 局部重绘同样返回四宫格候选
    console.log(`[live] 局部重绘完成 → ${repainted.images.map((i) => i.path).join(', ')}`)

    // 框外保持原样是这条链路的全部价值所在，逐像素比一遍下半部分
    const sharp = (await import('sharp')).default
    const cropBottom = async (buf: Buffer) => {
      const { width, height } = await sharp(buf).metadata()
      return sharp(buf)
        .extract({ left: 0, top: Math.round(height! * 0.5), width: width!, height: Math.round(height! * 0.4) })
        .raw().toBuffer()
    }
    const beforeBottom = await cropBottom(before)
    const afterBottom = await cropBottom(fs.readFileSync(repainted.images[0].path))
    const diff = beforeBottom.reduce(
      (acc, v, i) => acc + Math.abs(v - (afterBottom[i] ?? 0)), 0,
    ) / beforeBottom.length
    console.log(`[live] 框外平均像素差异 = ${diff.toFixed(2)}（0 表示完全没动）`)
    expect(diff).toBeLessThan(3)
  })

  test('垫图：本地图先经 describe 换成公网 URL，且同一张图第二次命中缓存不重复上传', async () => {
    const { MidjourneyClient } = await import('../client')
    const { resolveReferenceUrls, clearReferenceUrlCache } = await import('../reference')
    clearReferenceUrlCache()

    const client = new MidjourneyClient({ apiKey: KEY!, baseUrl: BASE_URL })
    const localImage = path.join(process.cwd(), 'public/etsy-images/985183548.jpg')
    const image = { type: 'path' as const, filePath: localImage }

    const first = await resolveReferenceUrls(client, [image])
    expect(first).toHaveLength(1)
    expect(first[0]).toMatch(/^https?:\/\//)

    // 第二次必须走缓存 —— 每次上传都是一次收费任务
    const started = Date.now()
    const second = await resolveReferenceUrls(client, [image])
    expect(second[0]).toBe(first[0])
    expect(Date.now() - started).toBeLessThan(1000)

    // 拿到的 URL 必须是公网免鉴权可读的，否则 MJ 读不到垫图
    const probe = await fetch(first[0])
    expect(probe.status).toBe(200)
    expect(probe.headers.get('content-type')).toMatch(/^image\//)
  })
})
