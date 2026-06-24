'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, Loader2, ChevronDown } from 'lucide-react'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  applied?: string[]
  pendingDeletes?: string[]
}

// 示例指令(点一下填进输入框,可再改)——让用户一眼知道能干啥。
const EXAMPLES = ['建个盯半导体的成员，接 qmt 行情', '把决策成员换成 sonnet 模型', '停用复盘成员']

/** AI 团队管家：用大白话增删改成员。建/改直接生效,删除当场二次确认。 */
export function TeamAssistant({ accountId, onChanged }: { accountId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [log, setLog] = useState<Turn[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, sending])

  const send = async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || sending) return
    setInput('')
    setLog((l) => [...l, { role: 'user', text: msg }])
    setSending(true)
    try {
      const r = await fetch('/api/mesh/team-assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg, accountId }),
      })
      const d = await r.json()
      if (!r.ok) setLog((l) => [...l, { role: 'assistant', text: d.error || '处理失败' }])
      else {
        setLog((l) => [...l, { role: 'assistant', text: d.reply || '(无回复)', applied: d.applied, pendingDeletes: d.pendingDeletes }])
        onChanged()
      }
    } catch {
      setLog((l) => [...l, { role: 'assistant', text: '请求失败' }])
    } finally {
      setSending(false)
    }
  }

  const confirmDelete = async (turnIdx: number, id: string) => {
    if (deleting) return
    setDeleting(id)
    try {
      const r = await fetch(`/api/mesh/agents?id=${encodeURIComponent(id)}&accountId=${accountId}`, { method: 'DELETE' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setLog((l) => l.map((t, i) => (i === turnIdx ? { ...t, applied: [...(t.applied ?? []), `删除 ${id} 失败：${d.error || r.status}`] } : t)))
        return
      }
      setLog((l) =>
        l.map((t, i) =>
          i === turnIdx ? { ...t, pendingDeletes: (t.pendingDeletes ?? []).filter((x) => x !== id), applied: [...(t.applied ?? []), `已删除 ${id}`] } : t,
        ),
      )
      onChanged()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <Bot className="h-4 w-4 text-indigo-600" />
        <span className="text-sm font-medium text-neutral-900">AI 团队管家</span>
        <span className="text-xs text-neutral-500">大白话增删改成员</span>
        <ChevronDown className={`ml-auto h-4 w-4 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {(log.length > 0 || sending) && (
            <div ref={logRef} className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3">
              {log.map((t, i) => (
                <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
                  <p className={`inline-block rounded-lg px-2.5 py-1.5 text-sm ${t.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700'}`}>{t.text}</p>
                  {t.applied && t.applied.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.applied.map((a, j) => (
                        <span key={j} className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">{a}</span>
                      ))}
                    </div>
                  )}
                  {t.pendingDeletes && t.pendingDeletes.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {t.pendingDeletes.map((id) => (
                        <div key={id} className="flex items-center gap-2 text-xs">
                          <span className="text-red-600">确认删除 {id}？</span>
                          <button onClick={() => confirmDelete(i, id)} disabled={deleting === id} className="rounded border border-red-200 px-2 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-50">
                            {deleting === id ? '删除中…' : '删除'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> AI 思考中…（约 20–30 秒）
                </div>
              )}
            </div>
          )}

          {log.length === 0 && !sending && (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setInput(ex)}
                  className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-600 hover:border-neutral-400"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="如：建个盯半导体的成员，用 opus，主动循环 30 秒，接 qmt 行情"
              className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
            <button
              onClick={() => send()}
              disabled={sending || !input.trim()}
              className="shrink-0 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {sending ? '处理中' : '发送'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
