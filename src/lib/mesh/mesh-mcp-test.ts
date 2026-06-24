/**
 * 「测试连接」—— 真起一次某个 mesh MCP server（按当前注册表/设置），
 * 走 initialize → tools/list 握手,返回它列出的工具,或捕获真实启动报错/stderr。
 * 让用户在界面上一键自检,不用再开命令行 import 试。
 */
import { spawn } from 'node:child_process'
import { getMeshMcpRegistry } from './mesh-agent-config'

export interface McpTestResult {
  ok: boolean
  tools: string[]
  error?: string
}

const TEST_TIMEOUT_MS = 10_000

export async function testMeshMcpServer(name: string): Promise<McpTestResult> {
  const cfg = getMeshMcpRegistry()[name]
  if (!cfg) return { ok: false, tools: [], error: `未注册的 MCP：${name}` }
  if (cfg.type !== 'stdio') return { ok: false, tools: [], error: `暂只支持 stdio 类型 MCP 的测试` }

  return new Promise<McpTestResult>((resolve) => {
    let stderr = ''
    let buf = ''
    let done = false
    const child = spawn(cfg.command, cfg.args ?? [], {
      env: { ...process.env, ...(cfg.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const finish = (r: McpTestResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { child.kill() } catch { /* ignore */ }
      resolve(r)
    }
    const timer = setTimeout(
      () => finish({ ok: false, tools: [], error: `超时 ${TEST_TIMEOUT_MS / 1000}s 未响应${stderr ? `；stderr：${stderr.slice(0, 600)}` : ''}` }),
      TEST_TIMEOUT_MS,
    )
    const send = (obj: unknown) => { try { child.stdin?.write(JSON.stringify(obj) + '\n') } catch { /* ignore */ } }

    child.on('error', (e) => finish({ ok: false, tools: [], error: `启动失败：${e.message}（检查 python 路径 / 脚本路径）` }))
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    // 用 close（所有 stdio 刷完才触发）而非 exit，否则快速退出的 server 的 tools/list 数据会被漏读、误报失败。
    child.on('close', (code, signal) =>
      finish({ ok: false, tools: [], error: `进程退出（${code === null ? `信号 ${signal}` : `code=${code}`}）${stderr ? `；${stderr.slice(0, 600)}` : ''}` }),
    )
    child.stdout?.on('data', (d) => {
      buf += d.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg: { id?: number; result?: { tools?: Array<{ name: string }> } }
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id === 1 && msg.result) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
        } else if (msg.id === 2 && msg.result?.tools) {
          finish({ ok: true, tools: msg.result.tools.map((t) => t.name) })
        }
      }
    })

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lumos-mesh-test', version: '1' } },
    })
  })
}
