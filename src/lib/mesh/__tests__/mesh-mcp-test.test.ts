import { writeFileSync } from 'fs'

// 一个真 stdio MCP server（node 跑），暴露 ping 工具——验证 test helper 的 spawn+握手+解析。
const PING_PATH = '/tmp/lumos-mcp-ping-test.mjs'
const PING_SRC = `
import readline from 'node:readline'
const rl = readline.createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') send({ jsonrpc:'2.0', id:m.id, result:{ protocolVersion:'2024-11-05', capabilities:{tools:{}}, serverInfo:{name:'ping',version:'1'} } })
  else if (m.method === 'tools/list') send({ jsonrpc:'2.0', id:m.id, result:{ tools:[{ name:'ping', description:'p', inputSchema:{type:'object'} }] } })
})
`

// 注册表用字面量路径（jest.mock 工厂会被 hoist，不能引外部变量）。
jest.mock('../mesh-agent-config', () => ({
  getMeshMcpRegistry: () => ({
    'ok-srv': { command: 'node', args: ['/tmp/lumos-mcp-ping-test.mjs'], type: 'stdio' },
    'bad-srv': { command: '/no/such/python311', args: ['x.py'], type: 'stdio' },
  }),
}))

import { testMeshMcpServer } from '../mesh-mcp-test'

beforeAll(() => writeFileSync(PING_PATH, PING_SRC))

describe('mesh-mcp-test —— 测试连接 helper', () => {
  it('能启动的 MCP：握手 + tools/list → ok + 工具名', async () => {
    const r = await testMeshMcpServer('ok-srv')
    expect(r.ok).toBe(true)
    expect(r.tools).toEqual(['ping'])
  })

  it('启动失败的 MCP：捕获真实报错(不是静默)', async () => {
    const r = await testMeshMcpServer('bad-srv')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('启动失败')
  })

  it('未注册的 MCP：明确报未注册', async () => {
    const r = await testMeshMcpServer('nope')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未注册')
  })
})
