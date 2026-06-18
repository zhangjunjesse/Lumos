import { parseLeaderResult, relaxesRisk, buildLeaderSchema } from '../mesh-command-schema'

describe('parseLeaderResult', () => {
  it('解析三类命令', () => {
    const r = parseLeaderResult({
      reply: '好的',
      commands: [
        { type: 'set_blacklist', symbols: ['600160.SH'], add: true },
        { type: 'set_focus', focus: '半导体' },
        { type: 'set_mode', mode: 'observe_only' },
      ],
    })
    expect(r.reply).toBe('好的')
    expect(r.commands).toHaveLength(3)
  })

  it('丢弃非法/未知命令（如 place_order、bad mode）', () => {
    const r = parseLeaderResult({
      commands: [
        { type: 'place_order', symbol: 'x' },
        { type: 'set_mode', mode: 'bad' },
        { type: 'set_focus', focus: 'ok' },
      ],
    })
    expect(r.commands).toHaveLength(1)
    expect(r.commands[0].type).toBe('set_focus')
  })

  it('set_blacklist 的 add 默认 true', () => {
    const r = parseLeaderResult({ commands: [{ type: 'set_blacklist', symbols: ['x'] }] })
    expect(r.commands[0]).toMatchObject({ type: 'set_blacklist', add: true })
  })

  it('relaxesRisk：解黑名单 / 切回 auto 为放宽', () => {
    expect(relaxesRisk({ type: 'set_blacklist', symbols: ['x'], add: false })).toBe(true)
    expect(relaxesRisk({ type: 'set_mode', mode: 'auto' })).toBe(true)
    expect(relaxesRisk({ type: 'set_blacklist', symbols: ['x'], add: true })).toBe(false)
    expect(relaxesRisk({ type: 'set_mode', mode: 'observe_only' })).toBe(false)
  })

  it('schema 命令白名单只有这三类（无直接下单）', () => {
    const s = buildLeaderSchema() as {
      properties: { commands: { items: { properties: { type: { enum: string[] } } } } }
    }
    expect(s.properties.commands.items.properties.type.enum).toEqual(['set_blacklist', 'set_focus', 'set_mode'])
  })
})
