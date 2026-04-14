import { createToApisProvider } from '../providers/toapis'
import { ImageGenError } from '../types'

describe('createToApisProvider', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('submits async generation, polls completion, and downloads images', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_123',
        status: 'queued',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_123',
        status: 'completed',
        progress: 100,
        result: {
          data: [{ url: 'https://files.toapis.com/image.png' }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(Buffer.from('png-binary'), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }))

    const provider = createToApisProvider({
      apiKey: 'toapis-key',
      baseUrl: 'https://toapis.com',
    })

    const result = await provider.generate({
      prompt: '生成电商主图',
      aspectRatio: '16:9',
      size: '2K',
      n: 1,
    })

    expect(result.model).toBe('gemini-3.1-flash-image-preview')
    expect(result.images).toHaveLength(1)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://toapis.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer toapis-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'gemini-3.1-flash-image-preview',
          prompt: '生成电商主图',
          size: '16:9',
          n: 1,
          metadata: { resolution: '2K' },
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://toapis.com/v1/images/generations/task_123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer toapis-key',
        }),
      }),
    )
  })

  test('uploads non-url reference images before generation', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          url: 'https://files.toapis.com/uploads/ref.png',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_234',
        status: 'queued',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_234',
        status: 'completed',
        result: {
          data: [{ url: 'https://files.toapis.com/generated.png' }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(Buffer.from('png-binary'), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }))

    const provider = createToApisProvider({
      apiKey: 'toapis-key',
      baseUrl: 'https://toapis.com',
    })

    await provider.generate({
      prompt: '保持商品主体不变，换成极简白底',
      images: [{ type: 'base64', data: Buffer.from('fake').toString('base64'), mimeType: 'image/png' }],
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://toapis.com/v1/uploads/images',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer toapis-key',
        }),
        body: expect.any(FormData),
      }),
    )
    const submitInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(String(submitInit.body)).toContain('https://files.toapis.com/uploads/ref.png')
  })

  test('maps failed task payloads into content policy errors', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_345',
        status: 'queued',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task_345',
        status: 'failed',
        error: {
          code: 'content_policy_violation',
          message: 'unsafe prompt',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const provider = createToApisProvider({
      apiKey: 'toapis-key',
      baseUrl: 'https://toapis.com',
    })

    await expect(provider.generate({
      prompt: 'unsafe prompt',
    })).rejects.toMatchObject<Partial<ImageGenError>>({
      code: 'content_policy',
      retryable: false,
    })
  })
})
