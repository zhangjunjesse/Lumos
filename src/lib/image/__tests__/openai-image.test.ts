import { createOpenAIImageProvider } from '../providers/openai-image'

describe('createOpenAIImageProvider', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('sends reference images using repeated image form fields for edits', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = createOpenAIImageProvider({
      apiKey: 'openai-key',
      baseUrl: 'https://image.example.com',
    })

    await provider.generate({
      prompt: 'Put Image 1 into a new product scene',
      images: [
        { type: 'base64', data: Buffer.from('ref-a').toString('base64'), mimeType: 'image/png' },
        { type: 'base64', data: Buffer.from('ref-b').toString('base64'), mimeType: 'image/png' },
      ],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://image.example.com/v1/images/edits',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer openai-key' }),
        body: expect.any(FormData),
      }),
    )

    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.getAll('image')).toHaveLength(2)
    expect(body.getAll('image[]')).toHaveLength(0)
  })
})
