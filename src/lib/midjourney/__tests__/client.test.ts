// Midjourney 客户端回归测试。每条用例都对应一个实测踩到的供应商行为，
// 不是假想的边界 —— 见 client.ts 顶部注释。

import { MidjourneyClient } from '../client'
import { ImageGenError } from '@/lib/image/types'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('MidjourneyClient', () => {
  const originalFetch = global.fetch
  const client = new MidjourneyClient({ apiKey: 'k', baseUrl: 'https://mj.test' })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('提交成功但任务终态失败时必须抛错 —— code:1 是假成功，不能当结果', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 1, description: 'Submit Success', result: 't1' }))
      .mockResolvedValueOnce(jsonResponse({
        id: 't1',
        status: 'FAILURE',
        // 实测:图片数量不对，供应商报的却是"提示词格式不正确"
        failReason: '[invalid_parameter] The prompt word format is incorrect, please check and try again.',
      }))
    global.fetch = fetchMock as unknown as typeof fetch

    const taskId = await client.submitImagine({ prompt: 'a cat' })
    expect(taskId).toBe('t1')

    await expect(client.waitForTask(taskId)).rejects.toMatchObject({
      code: 'invalid_params',
    })
  })

  test('code:21（等待填弹窗）是合法状态，不能当失败', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ code: 21, description: 'Waiting for window confirm', result: 't2' }),
    ) as unknown as typeof fetch

    const result = await client.submitAction('t1', 'MJ::Inpaint::1::x::SOLO')
    expect(result).toEqual({ taskId: 't2', needsModal: true })
  })

  test('上游返回 HTML（upstream_error）要说清是该能力未部署', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 4, description: 'readObjectStart: expect { or n, but found <', type: 'upstream_error' }),
        { status: 500 },
      ),
    ) as unknown as typeof fetch

    await expect(client.submitImagine({ prompt: 'x' })).rejects.toThrow(/未部署/)
  })

  test('model_not_found 要说清是未开通渠道，与未部署区分开', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'model_not_found', message: '分组 mj-fast 下模型 mj_upload 无可用渠道' } }),
        { status: 503 },
      ),
    ) as unknown as typeof fetch

    await expect(client.submitImagine({ prompt: 'x' })).rejects.toThrow(/未开通渠道/)
  })

  test('blend 图片数量不合法必须本地拦下，一个请求都不发 —— 供应商不校验，发出去就是白花钱', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(client.submitBlend({ base64Array: ['only-one'] })).rejects.toBeInstanceOf(ImageGenError)
    await expect(client.submitBlend({ base64Array: Array(6).fill('x') })).rejects.toThrow(/2-5 张/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('鉴权头两种都发 —— 中转网关认 Authorization，自建 proxy 认 mj-api-secret', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ code: 1, description: 'ok', result: 't7' }))
    global.fetch = fetchMock as unknown as typeof fetch

    await client.submitImagine({ prompt: 'x' })
    const postHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(postHeaders.Authorization).toBe('Bearer k')
    expect(postHeaders['mj-api-secret']).toBe('k')

    fetchMock.mockResolvedValue(jsonResponse({ id: 't7', status: 'SUCCESS' }))
    await client.fetchTask('t7')
    const getHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>
    expect(getHeaders.Authorization).toBe('Bearer k')
    expect(getHeaders['mj-api-secret']).toBe('k')
  })

  test('imagine 把垫图 URL 和 --ar 拼进 prompt —— MJ 的参数是写在提示词里的', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({ code: 1, description: 'ok', result: 't9' }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    await client.submitImagine({
      prompt: 'a woman wearing it',
      referenceUrls: ['https://cdn.test/a.png'],
      aspectRatio: '2:3',
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.prompt).toBe('https://cdn.test/a.png a woman wearing it --ar 2:3')
  })

  test('uploadImages 走 upload-discord-images，成功返回 URL 数组', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({ code: 1, description: 'ok', result: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'] }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const urls = await client.uploadImages(['data:image/png;base64,AAA', 'data:image/png;base64,BBB'])
    expect(urls).toEqual(['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'])
    expect(fetchMock.mock.calls[0][0]).toContain('/mj/submit/upload-discord-images')
  })

  test('uploadImages 上传失败(code≠1)要抛错，不能把错误描述当地址用', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ code: 4, description: 'base64 参数错误', result: null }),
    ) as unknown as typeof fetch
    await expect(client.uploadImages(['bad'])).rejects.toThrow(/参考图上传失败/)
  })

  test('内容审核失败要归到 content_policy，不能当成可重试的未知错误', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ id: 't3', status: 'FAILURE', failReason: 'Request blocked by content policy' }),
    ) as unknown as typeof fetch

    await expect(client.waitForTask('t3')).rejects.toMatchObject({
      code: 'content_policy',
      retryable: false,
    })
  })

  test('轮询时上游返回 HTML（带 200）要翻译成可读错误，而不是裸 SyntaxError', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('<!DOCTYPE html><html lang="zh-CN"><head></head></html>', { status: 200 }),
    ) as unknown as typeof fetch

    await expect(client.fetchTask('t8')).rejects.toBeInstanceOf(ImageGenError)
    await expect(client.fetchTask('t8')).rejects.not.toThrow(SyntaxError)
  })

  test('轮询扛得住网络抖动：单次 fetch failed 不杀整次生成，恢复后照常拿结果', async () => {
    jest.useFakeTimers()
    try {
      const fetchMock = jest.fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))   // 网络层抖一下
        .mockRejectedValueOnce(new TypeError('fetch failed'))   // 再抖一下
        .mockResolvedValue(jsonResponse({ id: 't7', status: 'SUCCESS', progress: '100%', imageUrl: 'https://x/o.png', buttons: [] }))
      global.fetch = fetchMock as unknown as typeof fetch

      const pending = client.waitForTask('t7')
      await jest.advanceTimersByTimeAsync(20000)
      const task = await pending
      expect(task.status).toBe('SUCCESS')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      jest.useRealTimers()
    }
  })

  test('轮询连续失败达到上限才放弃，且错误里说清是轮询挂了而不是任务挂了', async () => {
    jest.useFakeTimers()
    try {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch

      const pending = client.waitForTask('t7')
      pending.catch(() => {}) // 防未处理 rejection 告警
      await jest.advanceTimersByTimeAsync(60000)
      await expect(pending).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true })
      await expect(pending).rejects.toThrow(/轮询连续/)
    } finally {
      jest.useRealTimers()
    }
  })

  test('轮询遇到确定性错误(401)立刻放弃，不做无意义重试', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('{"error":{"message":"无效的令牌"}}', { status: 401 }),
    ) as unknown as typeof fetch

    await expect(client.waitForTask('t7')).rejects.toMatchObject({ code: 'invalid_params' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('SUCCESS 时返回完整任务对象（含按钮表，后续操作要靠它）', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        id: 't4',
        status: 'SUCCESS',
        progress: '100%',
        imageUrl: 'https://cdn.test/out.png',
        buttons: [{ customId: 'MJ::JOB::upsample::1::x', emoji: '', label: 'U1' }],
      }),
    ) as unknown as typeof fetch

    const task = await client.waitForTask('t4')
    expect(task.status).toBe('SUCCESS')
    expect(task.buttons).toHaveLength(1)
  })
})
