import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ApiProvider } from '@/types'

const mockCreateMediaRecord = jest.fn(() => 'media_video_1')
let mockMediaDir = ''

jest.mock('@/lib/image/persist', () => ({
  get MEDIA_DIR() {
    return mockMediaDir
  },
  createMediaRecord: (...args: unknown[]) => mockCreateMediaRecord(...args),
}))

jest.mock('@/lib/provider-resolver', () => ({
  resolveProviderForCapability: jest.fn(),
}))

jest.mock('@/lib/db/sessions', () => ({
  getSetting: jest.fn(() => ''),
}))

jest.mock('@/lib/claude/provider-env', () => ({
  getProviderEffectiveDefaultModel: jest.fn(() => ''),
}))

import { resolveProviderForCapability } from '@/lib/provider-resolver'
import { generateVideo, VideoGenError } from '../index'

const mockResolveProvider = resolveProviderForCapability as jest.MockedFunction<typeof resolveProviderForCapability>

function provider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'video-provider',
    name: 'ToAPIs Video',
    provider_type: 'toapis-video',
    api_protocol: 'openai-compatible',
    capabilities: '["video-gen"]',
    provider_origin: 'custom',
    auth_mode: 'api_key',
    base_url: 'https://toapis.com',
    api_key: 'toapis-key',
    is_active: 0,
    sort_order: 0,
    extra_env: '{}',
    model_catalog: JSON.stringify([{ value: 'wan2.6', label: 'Wan 2.6' }]),
    model_catalog_source: 'manual',
    model_catalog_updated_at: null,
    notes: '',
    is_builtin: 0,
    user_modified: 0,
    default_model: '',
    created_at: '2026-07-09 00:00:00',
    updated_at: '2026-07-09 00:00:00',
    ...overrides,
  }
}

describe('generateVideo ToAPIs integration', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.useFakeTimers()
    mockMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-video-test-'))
    mockCreateMediaRecord.mockClear()
    mockResolveProvider.mockReturnValue(provider())
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
    jest.restoreAllMocks()
    if (mockMediaDir) fs.rmSync(mockMediaDir, { recursive: true, force: true })
  })

  test('submits video task, polls completion, downloads output, and creates media record', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_video_1',
        status: 'queued',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_video_1',
        status: 'completed',
        progress: 100,
        model: 'wan2.6',
        result: { videos: [{ url: 'https://files.toapis.com/out.mp4' }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(Buffer.from('mp4-binary'), {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      }))

    const promise = generateVideo({
      prompt: 'A cinematic city sunrise with moving traffic.',
      model: 'wan2.6',
      aspectRatio: '16:9',
      duration: 10,
    })

    await jest.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(result.mediaGenerationId).toBe('media_video_1')
    expect(result.videos).toHaveLength(1)
    expect(result.videos[0].mimeType).toBe('video/mp4')
    expect(fs.existsSync(result.videos[0].localPath)).toBe(true)
    // 请求体 shape 以 ToAPIs 官方文档为准:aspect_ratio(非 size)、resolution 顶层小写、
    // duration 只能是模型档案里的合法值。字段拼错线上会 100% 提交失败,mock 测不出,别乱改。
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://toapis.com/v1/videos/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer toapis-key',
          'Content-Type': 'application/json',
        }),
        // 无参考素材时不带 metadata —— 网关会把 metadata 合并进模型参数,多余字段会踩到
        // 某些模型的同名参数(真机踩过 kling 的 mode)。
        body: JSON.stringify({
          model: 'wan2.6',
          prompt: 'A cinematic city sunrise with moving traffic.',
          aspect_ratio: '16:9',
          resolution: '720p',
          duration: 10,
        }),
      }),
    )
    expect(mockCreateMediaRecord).toHaveBeenCalledWith(expect.objectContaining({
      type: 'video',
      providerType: 'toapis-video',
      model: 'wan2.6',
      localPath: result.videos[0].localPath,
    }))
  })

  test('uploads local reference images before creating wan2.6-flash task', async () => {
    const refPath = path.join(mockMediaDir, 'ref.png')
    fs.writeFileSync(refPath, Buffer.from('png-ref'))
    mockResolveProvider.mockReturnValue(provider({
      model_catalog: JSON.stringify([{ value: 'wan2.6-flash', label: 'Wan 2.6 Flash' }]),
    }))

    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: { url: 'https://files.toapis.com/uploads/ref.png' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_video_2',
        status: 'queued',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_video_2',
        status: 'completed',
        result: { url: 'https://files.toapis.com/out.mp4' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(Buffer.from('mp4-binary'), {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      }))

    const promise = generateVideo({
      prompt: 'Animate Image 1 into a slow product reveal.',
      model: 'wan2.6-flash',
      referenceImagePaths: [refPath],
    })

    await jest.advanceTimersByTimeAsync(3000)
    await promise

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://toapis.com/v1/uploads/images',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer toapis-key' }),
        body: expect.any(FormData),
      }),
    )
    const submitInit = fetchMock.mock.calls[1][1] as RequestInit
    const submitBody = JSON.parse(String(submitInit.body)) as Record<string, unknown>
    // 参考图必须走顶层 image_urls;wan2.6-flash 不接受 aspect_ratio。
    expect(submitBody.image_urls).toEqual(['https://files.toapis.com/uploads/ref.png'])
    expect(submitBody).not.toHaveProperty('aspect_ratio')
    expect(submitBody).not.toHaveProperty('reference_images')
  })

  test('rejects durations the model does not support before any network call', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(generateVideo({
      prompt: 'A cinematic city sunrise with moving traffic.',
      model: 'wan2.6',
      duration: 6,
    })).rejects.toMatchObject<Partial<VideoGenError>>({ code: 'invalid_params' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('rejects wan2.6-flash with both image and video references (API 二选一)', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    mockResolveProvider.mockReturnValue(provider({
      model_catalog: JSON.stringify([{ value: 'wan2.6-flash', label: 'Wan 2.6 Flash' }]),
    }))

    await expect(generateVideo({
      prompt: 'Blend them.',
      model: 'wan2.6-flash',
      referenceImageUrls: ['https://example.com/a.png'],
      referenceVideoUrls: ['https://example.com/b.mp4'],
    })).rejects.toMatchObject<Partial<VideoGenError>>({ code: 'invalid_params' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('routes video references into metadata.reference_urls for wan2.6-flash', async () => {
    mockResolveProvider.mockReturnValue(provider({
      model_catalog: JSON.stringify([{ value: 'wan2.6-flash', label: 'Wan 2.6 Flash' }]),
    }))
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_video_3',
        status: 'queued',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_video_3',
        status: 'completed',
        result: { url: 'https://files.toapis.com/out.mp4' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(Buffer.from('mp4-binary'), {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      }))

    const promise = generateVideo({
      prompt: 'Restyle this clip.',
      model: 'wan2.6-flash',
      referenceVideoUrls: ['https://example.com/source.mp4'],
    })
    await jest.advanceTimersByTimeAsync(3000)
    await promise

    const submitBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      metadata: Record<string, unknown>
    }
    expect(submitBody.metadata.reference_urls).toEqual(['https://example.com/source.mp4'])
  })

  // 各家族请求体形状按官方文档锁定 — 字段名/投放位置错一个,线上就 100% 提交失败。
  describe('per-family request body shapes', () => {
    async function captureSubmitBody(params: Parameters<typeof generateVideo>[0], catalogModel: string) {
      mockResolveProvider.mockReturnValue(provider({
        model_catalog: JSON.stringify([{ value: catalogModel, label: catalogModel }]),
      }))
      const fetchMock = jest.fn()
      global.fetch = fetchMock as unknown as typeof fetch
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 't', status: 'queued' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 't', status: 'completed', result: { url: 'https://files.toapis.com/out.mp4' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        .mockResolvedValueOnce(new Response(Buffer.from('mp4'), {
          status: 200, headers: { 'Content-Type': 'video/mp4' },
        }))
      const promise = generateVideo(params)
      await jest.advanceTimersByTimeAsync(3000)
      await promise
      return JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>
    }

    test('grok: duration 传字符串、参考图字段是 images、分辨率小写', async () => {
      const body = await captureSubmitBody({
        prompt: 'p', model: 'grok-video-3', duration: 10, resolution: '480P',
        referenceImageUrls: ['https://example.com/a.png'],
      }, 'grok-video-3')
      expect(body.duration).toBe('10')
      expect(body.images).toEqual(['https://example.com/a.png'])
      expect(body.resolution).toBe('480p')
    })

    test('kling: 参考图字段是 reference_images、分辨率映射为 mode std/pro', async () => {
      const body = await captureSubmitBody({
        prompt: 'p', model: 'kling-v2-6', duration: 5, resolution: '1080P',
        referenceImageUrls: ['https://example.com/a.png'],
      }, 'kling-v2-6')
      expect(body.reference_images).toEqual(['https://example.com/a.png'])
      expect(body.mode).toBe('pro')
      expect(body).not.toHaveProperty('resolution')
    })

    test('seedance-2: 参考图/参考视频走角色数组协议', async () => {
      const body = await captureSubmitBody({
        prompt: 'p', model: 'seedance-2', duration: 5,
        referenceImageUrls: ['https://example.com/a.png'],
        referenceVideoUrls: ['https://example.com/b.mp4'],
      }, 'seedance-2')
      expect(body.image_with_roles).toEqual([{ url: 'https://example.com/a.png', role: 'reference_image' }])
      expect(body.video_with_roles).toEqual([{ url: 'https://example.com/b.mp4', role: 'reference_video' }])
    })

    test('豆包 1.5 Pro: 首尾帧角色按序分配、resolution 落在 metadata', async () => {
      const body = await captureSubmitBody({
        prompt: 'p', model: 'doubao-seedance-1-5-pro', duration: 5, resolution: '720P',
        referenceImageUrls: ['https://example.com/first.png', 'https://example.com/last.png'],
      }, 'doubao-seedance-1-5-pro')
      expect(body.image_with_roles).toEqual([
        { url: 'https://example.com/first.png', role: 'first_frame' },
        { url: 'https://example.com/last.png', role: 'last_frame' },
      ])
      expect((body.metadata as Record<string, unknown>).resolution).toBe('720p')
      expect(body).not.toHaveProperty('resolution')
    })

    test('happyhorse: 请求体带 action,视频编辑传顶层 url', async () => {
      const body = await captureSubmitBody({
        prompt: 'p', model: 'happyhorse-1.1', duration: 5,
        referenceVideoUrls: ['https://example.com/src.mp4'],
      }, 'happyhorse-1.1')
      expect(body.action).toBe('video-edit')
      expect(body.url).toBe('https://example.com/src.mp4')
    })

    test('海螺: 不发送 aspect_ratio,未指定分辨率时按档案兜底(768P 而非 720P)', async () => {
      const body = await captureSubmitBody({
        prompt: 'p', model: 'MiniMax-Hailuo-02', duration: 6, aspectRatio: '16:9',
      }, 'MiniMax-Hailuo-02')
      expect(body).not.toHaveProperty('aspect_ratio')
      expect(body.resolution).toBe('768P')
    })

    test('kling omni: 参考图协议未接入,传参考图直接明确报错', async () => {
      const fetchMock = jest.fn()
      global.fetch = fetchMock as unknown as typeof fetch
      mockResolveProvider.mockReturnValue(provider({
        model_catalog: JSON.stringify([{ value: 'kling-v3-omni', label: 'omni' }]),
      }))
      await expect(generateVideo({
        prompt: 'p', model: 'kling-v3-omni', duration: 5,
        referenceImageUrls: ['https://example.com/a.png'],
      })).rejects.toMatchObject<Partial<VideoGenError>>({ code: 'invalid_params' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  test('rejects wan2.6-flash pure text-to-video before provider submission', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    mockResolveProvider.mockReturnValue(provider({
      model_catalog: JSON.stringify([{ value: 'wan2.6-flash', label: 'Wan 2.6 Flash' }]),
    }))

    await expect(generateVideo({
      prompt: 'A cinematic city sunrise with moving traffic.',
      model: 'wan2.6-flash',
    })).rejects.toMatchObject<Partial<VideoGenError>>({
      code: 'invalid_params',
      retryable: false,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
