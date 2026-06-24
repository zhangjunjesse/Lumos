'use client'

import { useState, useEffect, type ReactNode } from 'react'

interface Qmt {
  qmtDir: string
  qmtPython: string
  qmtPath: string
  qmtAccountId: string
}
interface TestResult {
  ok: boolean
  tools: string[]
  error?: string
}
const EMPTY: Qmt = { qmtDir: '', qmtPython: '', qmtPath: '', qmtAccountId: '' }
const INPUT = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'

/** qmt 数据源接入设置（全局）+ 一键测试连接。把写死的脚本路径变成可配,失败原因可见。 */
export function McpSettings() {
  const [qmt, setQmt] = useState<Qmt>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)

  useEffect(() => {
    fetch('/api/mesh/settings')
      .then((r) => r.json())
      .then((d) => setQmt({ ...EMPTY, ...(d.qmt ?? {}) }))
      .catch(() => {})
  }, [])

  const set = (p: Partial<Qmt>) => {
    setQmt((q) => ({ ...q, ...p }))
    setSaved(false)
  }
  const save = async () => {
    setSaving(true)
    try {
      await fetch('/api/mesh/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(qmt) })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }
  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      // 先存当前表单值——测试读的是已保存配置,不先存会测成旧值（H-2）。
      await fetch('/api/mesh/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(qmt) })
      setSaved(true)
      setTest(await fetch('/api/mesh/mcp-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'qmt-readonly' }) }).then((r) => r.json()))
    } catch {
      setTest({ ok: false, tools: [], error: '请求失败' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 space-y-3">
      <h3 className="text-sm font-medium text-neutral-900">qmt 数据源</h3>
      <p className="text-xs text-neutral-500">全局,所有工作室共用。留空走内置默认。保存后下一轮生效。「测试连接」会先存当前填写再当场验。</p>
      <Field label="脚本目录（含 qmt_mcp_server.py）">
        <input className={INPUT} value={qmt.qmtDir} onChange={(e) => set({ qmtDir: e.target.value })} placeholder="如 C:\Users\Administrator\Desktop\量化（留空=用户目录\Downloads\量化）" />
      </Field>
      <Field label="python 解释器路径">
        <input className={INPUT} value={qmt.qmtPython} onChange={(e) => set({ qmtPython: e.target.value })} placeholder="如 C:\Python311\python.exe（留空=Windows 默认 C:\Python311）" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="QMT 安装路径（userdata_mini）">
          <input className={INPUT} value={qmt.qmtPath} onChange={(e) => set({ qmtPath: e.target.value })} placeholder="留空=脚本默认" />
        </Field>
        <Field label="QMT 账户号">
          <input className={INPUT} value={qmt.qmtAccountId} onChange={(e) => set({ qmtAccountId: e.target.value })} placeholder="留空=脚本默认" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {saving ? '保存中…' : '保存 qmt 设置'}
        </button>
        <button onClick={runTest} disabled={testing} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
          {testing ? '测试中…' : '测试连接'}
        </button>
        {saved && <span className="text-sm text-emerald-600">已保存</span>}
      </div>
      {test && (
        <div className={`rounded-lg border p-3 text-xs ${test.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
          {test.ok ? (
            <>
              ✓ 连接成功 · {test.tools.length} 个工具
              {test.tools.length > 0 && <span className="text-neutral-500">（{test.tools.join('、')}）</span>}
            </>
          ) : (
            `✗ 连接失败：${test.error}`
          )}
        </div>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  )
}
