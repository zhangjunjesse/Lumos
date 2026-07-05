'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Loader2, X } from 'lucide-react'
import { ModelMenu } from './model-menu'
import type { ProviderModelGroup } from '@/types'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  applied?: string[]
  pendingDeletes?: string[]
}

// 示例指令(点一下填进输入框,可再改)——让用户一眼知道能干啥。
const EXAMPLES = ['建个盯半导体的成员，接 qmt 行情', '把决策成员换成 sonnet 模型', '停用复盘成员']

/**
 * AI 团队管家：右下角浮动入口，点开是对话面板。用大白话增删改当前工作室的全部成员，
 * 建/改直接生效、删除当场二次确认；面板头部可定义管家自己用的服务商/模型、可清空会话。
 */
export function MeshButler({ accountId, onChanged }: { accountId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [log, setLog] = useState<Turn[]>([])
  const [groups, setGroups] = useState<ProviderModelGroup[]>([])
  const [model, setModel] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  // 面板首次展开时拉服务商/模型列表 + 已保存的管家模型（point 1：可定义服务商/模型）。
  useEffect(() => {
    if (!open || groups.length) return
    fetch('/api/providers/models').then((r) => r.json()).then((d) => setGroups(d.groups ?? [])).catch(() => {})
    fetch('/api/mesh/settings').then((r) => r.json()).then((d) => setModel(d?.assistant?.model ?? '')).catch(() => {})
  }, [open, groups.length])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, sending])

  // 选模型即存全局设置；管家下次调用就用它（runTeamAssistant 服务端读取）。
  const pickModel = useCallback((providerId: string, m: string) => {
    setModel(m)
    fetch('/api/mesh/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assistantProviderId: providerId, assistantModel: m }),
    }).catch(() => {})
  }, [])

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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="AI 团队管家"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg ring-1 ring-black/5 hover:bg-neutral-700"
      >
        <Bot className="h-6 w-6" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[540px] w-[400px] flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <Bot className="h-4 w-4 text-indigo-600" />
        <span className="text-sm font-medium text-neutral-900">AI 团队管家</span>
        <span className="text-xs text-neutral-400">大白话增删改成员</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setLog([])}
            disabled={!log.length}
            className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
          >
            清空
          </button>
          <button onClick={() => setOpen(false)} title="收起" className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2">
        <span className="shrink-0 text-xs text-neutral-400">管家用</span>
        <ModelMenu groups={groups} value={model} onChange={pickModel} className="flex-1" />
      </div>

      <div ref={logRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {log.length === 0 && !sending && (
          <div className="space-y-3">
            <p className="text-xs text-neutral-400">用大白话让我增删改这个团队的成员，例如：</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setInput(ex)} className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-600 hover:border-neutral-400">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
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

      <div className="flex gap-2 border-t border-neutral-100 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
          placeholder="如：建个盯半导体的成员，用 opus，接 qmt 行情"
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
  )
}
