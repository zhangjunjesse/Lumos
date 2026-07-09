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
        body: JSON.stringify({
          model: 'wan2.6',
          prompt: 'A cinematic city sunrise with moving traffic.',
          aspect_ratio: '16:9',
          resolution: '720p',
          duration: 10,
          metadata: {
            mode: 'text-to-video',
          },
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
