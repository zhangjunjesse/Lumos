// T5.1 逃生舱:把用户口头说的服务商名字/类型解析成 provider id。
// 只在支持 image-gen 的服务商里匹配;写错名字返回 undefined(回落就近链,不报错)。

const providers = [
  { id: 'p-mj', name: 'Midjourney', provider_type: 'midjourney', capabilities: '["image-gen"]' },
  { id: 'p-db', name: '豆包 Seedream', provider_type: 'volcengine', capabilities: '["image-gen"]' },
  { id: 'p-chat', name: '某聊天模型', provider_type: 'anthropic', capabilities: '["agent-chat"]' },
]

jest.mock('@/lib/db/providers', () => ({ getAllProviders: () => providers }))
jest.mock('@/lib/provider-config', () => ({
  providerSupportsCapability: (p: { capabilities: string }, cap: string) => p.capabilities.includes(cap),
}))

import { resolveImageProviderIdByHint } from '../image-provider-hint'

describe('resolveImageProviderIdByHint (T5.1 逃生舱)', () => {
  it('按 provider_type 精确匹配(大小写不敏感)', () => {
    expect(resolveImageProviderIdByHint('midjourney')).toBe('p-mj')
    expect(resolveImageProviderIdByHint('MidJourney')).toBe('p-mj')
  })
  it('按 name 精确匹配', () => {
    expect(resolveImageProviderIdByHint('Midjourney')).toBe('p-mj')
  })
  it('包含匹配:"MJ"匹配不到但"豆包"能命中 name 片段', () => {
    expect(resolveImageProviderIdByHint('豆包')).toBe('p-db')
  })
  it('只在图片服务商里找,不会匹配到聊天服务商', () => {
    expect(resolveImageProviderIdByHint('某聊天模型')).toBeUndefined()
  })
  it('写错/未知名字 → undefined(回落就近链,不报错)', () => {
    expect(resolveImageProviderIdByHint('不存在的服务商')).toBeUndefined()
  })
  it('空/空白 → undefined', () => {
    expect(resolveImageProviderIdByHint('')).toBeUndefined()
    expect(resolveImageProviderIdByHint('  ')).toBeUndefined()
    expect(resolveImageProviderIdByHint(undefined)).toBeUndefined()
  })
})
