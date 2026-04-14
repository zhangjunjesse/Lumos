import {
  buildImageGenerationSystemPrompt,
  parseImageProviderDefaults,
  serializeImageProviderDefaults,
} from '../provider-defaults'

describe('image provider defaults', () => {
  test('serializes and parses defaults from extra_env', () => {
    const raw = serializeImageProviderDefaults('{"API_KEY":"secret"}', {
      aspectRatio: '16:9',
      resolution: '2K',
      count: 2,
      providerOptions: {
        metadata: {
          resolution: '2K',
        },
      },
    })

    expect(JSON.parse(raw)).toMatchObject({
      API_KEY: 'secret',
    })
    expect(parseImageProviderDefaults(raw)).toEqual({
      aspectRatio: '16:9',
      resolution: '2K',
      count: 2,
      providerOptions: {
        metadata: {
          resolution: '2K',
        },
      },
    })
  })

  test('removes defaults key when defaults are empty', () => {
    const raw = serializeImageProviderDefaults('{"API_KEY":"secret","LUMOS_IMAGE_DEFAULTS":"{\\"aspectRatio\\":\\"1:1\\"}"}', {})
    expect(parseImageProviderDefaults(raw)).toEqual({})
    expect(JSON.parse(raw)).toEqual({ API_KEY: 'secret' })
  })

  test('builds system prompt from explicit overrides', () => {
    const prompt = buildImageGenerationSystemPrompt({
      aspectRatio: '21:9',
      resolution: '4K',
      count: 1,
      providerOptions: { metadata: { resolution: '4K' } },
    })

    expect(prompt).toContain('aspect_ratio: "21:9"')
    expect(prompt).toContain('image_size: "4K"')
    expect(prompt).toContain('provider_options:')
  })
})
