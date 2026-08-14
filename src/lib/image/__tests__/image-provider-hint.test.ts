// T5.1 逃生舱(issue #64 后契约):把用户口头说的服务商名字/类型解析成 provider id。
// 只在支持 image-gen 的服务商里精确匹配;匹配不到返回结构化 not_found(带可用清单),
// 由调用方硬报错 —— 不再静默回落默认服务商。包含匹配降级为 didYouMean 建议。

const providers = [
  { id: 'p-mj', name: 'MidjourneyJ', provider_type: 'midjourney', capabilities: '["image-gen"]' },
  { id: 'p-db', name: '豆包 Seedream', provider_type: 'volcengine', capabilities: '["image-gen"]' },
  { id: 'p-chat', name: '某聊天模型', provider_type: 'anthropic', capabilities: '["agent-chat"]' },
]

jest.mock('@/lib/db/providers', () => ({ getAllProviders: () => providers }))
jest.mock('@/lib/provider-config', () => ({
  providerSupportsCapability: (p: { capabilities: string }, cap: string) => p.capabilities.includes(cap),
}))

import { resolveExplicitImageProvider, sanitizeImageProviderId } from '../image-provider-hint'

describe('resolveExplicitImageProvider', () => {
  it('按 provider_type 精确匹配(大小写不敏感)', () => {
    expect(resolveExplicitImageProvider('midjourney')).toEqual(
      { kind: 'ok', providerId: 'p-mj', providerName: 'MidjourneyJ' },
    )
    expect(resolveExplicitImageProvider('MidJourney')).toMatchObject({ kind: 'ok', providerId: 'p-mj' })
  })

  it('按 name 精确匹配', () => {
    expect(resolveExplicitImageProvider('MidjourneyJ')).toMatchObject({ kind: 'ok', providerId: 'p-mj' })
  })

  it('只在图片服务商里找,聊天服务商即使名字对上也是 not_found', () => {
    expect(resolveExplicitImageProvider('某聊天模型')).toMatchObject({ kind: 'not_found' })
  })

  it('写错名字 → not_found,带全部可用清单供 AI 自纠(不再静默回落)', () => {
    const r = resolveExplicitImageProvider('不存在的服务商')
    expect(r).toMatchObject({ kind: 'not_found', requested: '不存在的服务商' })
    if (r.kind === 'not_found') {
      expect(r.available).toEqual([
        { name: 'MidjourneyJ', type: 'midjourney' },
        { name: '豆包 Seedream', type: 'volcengine' },
      ])
    }
  })

  it('片段能对上时给 didYouMean 建议,但绝不自动采用', () => {
    const r = resolveExplicitImageProvider('豆包')
    expect(r).toMatchObject({ kind: 'not_found', didYouMean: '豆包 Seedream' })
  })

  it('空/空白/未传 → none(走就近链,不算显式指定)', () => {
    expect(resolveExplicitImageProvider('')).toEqual({ kind: 'none' })
    expect(resolveExplicitImageProvider('  ')).toEqual({ kind: 'none' })
    expect(resolveExplicitImageProvider(undefined)).toEqual({ kind: 'none' })
  })
})

describe('sanitizeImageProviderId (历史绑定失效回退,语义与显式指定不同,保持降级)', () => {
  it('绑定的服务商仍可用 → 原样返回', () => {
    expect(sanitizeImageProviderId('p-mj', '会话')).toBe('p-mj')
  })
  it('绑定的服务商已被删除 → undefined(回退全局默认)', () => {
    expect(sanitizeImageProviderId('p-deleted', '会话')).toBeUndefined()
  })
  it('绑定的服务商不支持 image-gen(能力被改) → undefined', () => {
    expect(sanitizeImageProviderId('p-chat', '团队默认')).toBeUndefined()
  })
  it('空值 → undefined', () => {
    expect(sanitizeImageProviderId('', '会话')).toBeUndefined()
    expect(sanitizeImageProviderId(null, '会话')).toBeUndefined()
  })
})
