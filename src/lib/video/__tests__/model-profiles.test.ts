import {
  formatDurations,
  getVideoModelProfile,
  isKnownVideoModel,
  listKnownVideoModels,
  resolveResolutionParam,
  unionOfKnownProfiles,
  validateVideoDuration,
} from '../model-profiles'
import { PROVIDER_PRESETS } from '@/lib/provider-preset-data'

describe('视频模型档案 — 单一真源守护', () => {
  test('预设目录里的每个模型都必须有参数档案(禁止无档案上架)', () => {
    const videoPreset = PROVIDER_PRESETS.find(p => p.id === 'toapis-wan-video')
    expect(videoPreset).toBeDefined()
    for (const model of videoPreset!.default_models ?? []) {
      expect({ model: model.value, known: isKnownVideoModel(model.value) })
        .toEqual({ model: model.value, known: true })
    }
  })

  test('每个档案的默认时长必须是自己的合法值', () => {
    for (const model of listKnownVideoModels()) {
      const profile = getVideoModelProfile(model)
      if (profile.durations.length === 0) continue
      expect({ model, ok: profile.durations.includes(profile.defaultDuration) })
        .toEqual({ model, ok: true })
    }
  })

  test('kling 系分辨率经 mode 映射(720P→std / 1080P→pro),大小写不敏感', () => {
    const profile = getVideoModelProfile('kling-v3')
    expect(resolveResolutionParam(profile, '720p'))
      .toEqual({ field: 'mode', value: 'std', inMetadata: false })
    expect(resolveResolutionParam(profile, '1080P'))
      .toEqual({ field: 'mode', value: 'pro', inMetadata: false })
  })

  test('veo3.1 逆向版与豆包 1.5 的 resolution 落在 metadata,4K 大小写归一', () => {
    expect(resolveResolutionParam(getVideoModelProfile('veo3.1-fast'), '4K'))
      .toEqual({ field: 'resolution', value: '4k', inMetadata: true })
    expect(resolveResolutionParam(getVideoModelProfile('doubao-seedance-1-5-pro'), '720P'))
      .toEqual({ field: 'resolution', value: '720p', inMetadata: true })
  })

  test('非法分辨率返回 undefined,由调用方报错', () => {
    expect(resolveResolutionParam(getVideoModelProfile('grok-video-3'), '1080P')).toBeUndefined()
  })

  test('时长校验按模型给出合法值提示', () => {
    expect(validateVideoDuration('sora-2-official', 8)).toEqual({ ok: true })
    const bad = validateVideoDuration('sora-2-official', 5)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('4/8/12')
  })

  test('formatDurations:连续区间压缩,离散值列举', () => {
    expect(formatDurations([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])).toBe('3-15')
    expect(formatDurations([4, 6, 10])).toBe('4/6/10')
  })

  test('UI 并集覆盖各家族档位(21:9 / 4K / 9 张参考图)', () => {
    const union = unionOfKnownProfiles()
    expect(union.aspectRatios).toContain('21:9')
    expect(union.resolutions).toContain('4K')
    expect(union.maxReferenceImages).toBe(9)
    expect(union.durations).toContain(2)
    expect(union.durations).toContain(16)
  })
})
