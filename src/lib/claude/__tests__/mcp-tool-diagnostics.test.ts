// #57:MCP server 没连上时 SDK 报 "No such tool available",把排查引向注册表(而注册表往往正常)。
// 这里的诊断补一句真因。行为要钉死:只在真的匹配上时才追加,绝不改动其它工具错误的原文。

import { buildMcpToolErrorDiagnostic, parseMcpServerName } from '../mcp-tool-diagnostics'

describe('parseMcpServerName', () => {
  it('从 mcp__server__tool 取 server 名', () => {
    expect(parseMcpServerName('mcp__pinterest-dl__pinterest_status')).toBe('pinterest-dl')
    expect(parseMcpServerName('mcp__lumos-image__generate_image')).toBe('lumos-image')
  })
  it('带下划线的 server 名也能取(贪婪到最后一个 __)', () => {
    expect(parseMcpServerName('mcp__my_server__do_thing')).toBe('my_server')
  })
  it('非 MCP 工具名 → undefined', () => {
    expect(parseMcpServerName('Read')).toBeUndefined()
    expect(parseMcpServerName('')).toBeUndefined()
  })
})

describe('buildMcpToolErrorDiagnostic (#57)', () => {
  const statuses = [
    { name: 'pinterest-dl', status: 'failed' },
    { name: 'lumos-image', status: 'connected' },
    { name: 'slow-one', status: 'pending' },
  ]

  it('server 连接失败 → 明说不是"工具不存在",而是连接失败', () => {
    const d = buildMcpToolErrorDiagnostic(
      'Error: No such tool available: mcp__pinterest-dl__pinterest_status', statuses)
    expect(d).toContain('不是"工具不存在"')
    expect(d).toContain('pinterest-dl')
    expect(d).toContain('连接失败')
  })

  it('server 仍在启动 → 提示 pending 语义', () => {
    const d = buildMcpToolErrorDiagnostic('No such tool available: mcp__slow-one__x', statuses)
    expect(d).toContain('启动中')
  })

  it('server 显示已连接 → 给出"声明与连接不同步"的方向,不乱猜原因', () => {
    const d = buildMcpToolErrorDiagnostic('No such tool available: mcp__lumos-image__generate_image', statuses)
    expect(d).toContain('显示已连接')
    expect(d).toContain('不同步')
  })

  it('本轮没拿到连接态 → 仍给方向,但不编造状态', () => {
    const d = buildMcpToolErrorDiagnostic('No such tool available: mcp__x-server__y', undefined)
    expect(d).toContain('连接状态未知')
  })

  it('不是"No such tool"的错误 → 原样不动(不污染其它报错)', () => {
    expect(buildMcpToolErrorDiagnostic('Error: request timed out', statuses)).toBeUndefined()
    expect(buildMcpToolErrorDiagnostic('图片生成失败: 余额不足', statuses)).toBeUndefined()
  })

  it('内置工具报"不存在" → 不追加(不是 MCP 的事)', () => {
    expect(buildMcpToolErrorDiagnostic('No such tool available: Bash', statuses)).toBeUndefined()
  })
})
