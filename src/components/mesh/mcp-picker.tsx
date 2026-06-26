'use client'

import { useState } from 'react'

interface McpOption {
  name: string
  description: string
  /** 框架自带的 in-process 能力（如下单 mesh-trade）：直接注入、无 stdio 连接，故不显示「测试连接」。 */
  builtin?: boolean
}
interface McpStat {
  name: string
  status: string
}
interface TestResult {
  ok: boolean
  tools: string[]
  error?: string
}

/** 给单个 agent 勾选 MCP 工具 + 显示上轮连接状态 + 一键测试连接。下单类永不出现在这里。 */
export function McpPicker({
  options,
  value,
  onChange,
  status = [],
}: {
  options: McpOption[]
  value: string[]
  onChange: (next: string[]) => void
  status?: McpStat[]
}) {
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, TestResult>>({})

  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name])
  const lastStatus = (name: string) => status.find((s) => s.name === name)?.status
  const test = async (name: string) => {
    setTesting(name)
    try {
      const r = (await fetch('/api/mesh/mcp-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then((res) => res.json())) as TestResult
      setResults((m) => ({ ...m, [name]: r }))
    } catch {
      setResults((m) => ({ ...m, [name]: { ok: false, tools: [], error: '请求失败' } }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-neutral-500">成员能力（行情/数据 MCP + 下单等框架能力；勾选即授权该成员使用）</p>
      {options.length === 0 ? (
        <p className="text-xs text-neutral-400">暂无可授能力</p>
      ) : (
        options.map((o) => {
          const on = value.includes(o.name)
          const st = lastStatus(o.name)
          const res = results[o.name]
          return (
            <div key={o.name} className="rounded-lg border border-neutral-200 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <label className="flex flex-1 cursor-pointer items-center gap-1.5 text-xs" title={o.description}>
                  <input type="checkbox" checked={on} onChange={() => toggle(o.name)} className="h-3.5 w-3.5" />
                  <span className={on ? 'text-neutral-800' : 'text-neutral-500'}>{o.name}</span>
                  {o.builtin && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">内置</span>}
                </label>
                {!o.builtin && st && (
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${st === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                    上轮{st === 'connected' ? '已连' : `失败(${st})`}
                  </span>
                )}
                {!o.builtin && (
                  <button
                    type="button"
                    onClick={() => test(o.name)}
                    disabled={testing === o.name}
                    className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {testing === o.name ? '测试中…' : '测试连接'}
                  </button>
                )}
              </div>
              {o.builtin ? (
                <p className="mt-1 text-[11px] text-neutral-400">{o.description}</p>
              ) : (
                res &&
                (res.ok ? (
                  <p className="mt-1.5 text-[11px] text-emerald-700">
                    ✓ 连接成功 · {res.tools.length} 个工具
                    {res.tools.length > 0 && <span className="text-neutral-400">（{res.tools.join('、')}）</span>}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[11px] text-red-600">✗ {res.error}</p>
                ))
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
