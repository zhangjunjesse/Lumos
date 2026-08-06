// 团队成员级图片服务商分流(T3.2):成员绑了服务商 → 在其 agent 提示词里注入"出图用 X",
// 由 T5.1 逃生舱接住。这是团队出图 HTTP 回调拿不到成员身份时,让成员身份生效的唯一注入点。

import { toAgentDefinitions, type TeamAgentSpec } from '../agent-defs'

const base: TeamAgentSpec = { key: 'a', description: 'x', prompt: '你是设计师。' }

describe('toAgentDefinitions 成员级图片服务商注入', () => {
  it('成员绑了服务商 → 提示词末尾注入 image_provider 指令', () => {
    const defs = toAgentDefinitions([{ ...base, imageProviderName: 'Midjourney' }])
    expect(defs.a.prompt).toContain('你是设计师。')
    expect(defs.a.prompt).toContain('image_provider')
    expect(defs.a.prompt).toContain('"Midjourney"')
  })

  it('成员没绑 → 不注入,提示词原样(降级到团队默认/全局)', () => {
    const defs = toAgentDefinitions([base])
    expect(defs.a.prompt).toBe('你是设计师。')
    expect(defs.a.prompt).not.toContain('image_provider')
  })

  it('同团队不同成员各自注入各自的服务商', () => {
    const defs = toAgentDefinitions([
      { key: 'print', description: '印花', prompt: '印花设计师。', imageProviderName: 'Midjourney' },
      { key: 'scene', description: '场景', prompt: '场景摄影师。', imageProviderName: '豆包 Seedream' },
    ])
    expect(defs.print.prompt).toContain('"Midjourney"')
    expect(defs.scene.prompt).toContain('"豆包 Seedream"')
    expect(defs.print.prompt).not.toContain('豆包')
  })
})
