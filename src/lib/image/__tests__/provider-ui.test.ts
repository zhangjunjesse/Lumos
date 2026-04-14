import { getImageProviderUiConfig } from '../provider-ui'

describe('getImageProviderUiConfig', () => {
  test('returns extended aspect ratios for ToAPIs nano banana2', () => {
    const config = getImageProviderUiConfig('toapis-image')

    expect(config.supportedAspectRatios).toEqual(expect.arrayContaining([
      '1:4', '4:1', '1:8', '8:1',
    ]))
    expect(config.maxReferenceImages).toBe(14)
    expect(config.advancedOptions).toEqual({})
  })

  test('passes provider-specific advanced options through for dashscope', () => {
    const config = getImageProviderUiConfig('dashscope', {
      thinking_mode: {
        type: 'boolean',
        label: '思考模式',
      },
    })

    expect(config.advancedOptions).toMatchObject({
      thinking_mode: {
        type: 'boolean',
        label: '思考模式',
      },
    })
  })
})
