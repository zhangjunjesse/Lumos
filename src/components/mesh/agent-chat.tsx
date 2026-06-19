'use client'

import { useState, type ReactNode } from 'react'
import { agentMeta } from './agent-meta'
import type { MsgRecord } from './war-room'

const fmtTime = (s: string) => s.split(' ')[1] ?? s

function payloadText(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('，')
  }
  return String(payload ?? '')
}

interface AppliedItem {
  command?: { type?: string; mode?: string; focus?: string; symbols?: string[]; add?: boolean }
}
function describeApplied(applied: unknown): string[] {
  if (!Array.isArray(applied)) return []
  return (applied as AppliedItem[])
    .map((a) => {
      const c = a?.command
      if (!c) return ''
      if (c.type === 'set_mode') return c.mode === 'auto' ? '切换：自动交易' : '切换：只看不买'
      if (c.type === 'set_focus') return `关注：${c.focus}`
      if (c.type === 'set_blacklist') return `${c.add ? '拉黑' : '解禁'}：${(c.symbols ?? []).join('、')}`
      return c.type ?? ''
    })
    .filter(Boolean)
}

interface LocalMsg {
  kind: 'user' | 'command'
  from: string
  text: string
  applied?: string[]
}

export function AgentChat({ messages }: { messages: MsgRecord[] }) {
  const [local, setLocal] = useState<LocalMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const send = async () => {
    const msg = input.trim()
    if (!msg || sending) return
    setInput('')
    setLocal((l) => [...l, { kind: 'user', from: 'user', text: msg }])
    setSending(true)
    try {
      const r = await fetch('/api/mesh/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const data = await r.json()
      setLocal((l) => [...l, { kind: 'command', from: 'team.leader', text: data.reply || '(无回复)', applied: describeApplied(data.applied) }])
    } catch {
      setLocal((l) => [...l, { kind: 'command', from: 'team.leader', text: '(指令处理失败)' }])
    } finally {
      setSending(false)
    }
  }

  const empty = messages.length === 0 && local.length === 0

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-900">团队消息流</h2>
        <p className="mt-0.5 text-xs text-neutral-400">事件广播 · 定向任务 · 回执 · 你与队长的指挥</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {empty && <div className="py-8 text-center text-sm text-neutral-400">还没有消息 —— 启动团队，或在下方给队长下令</div>}

        {messages.map((m) => {
          const meta = agentMeta(m.from)
          const p = (m.payload ?? {}) as { summary?: string; to?: string; taskId?: string }
          if (m.topic === 'agent_task') {
            return (
              <Row key={m.id} name={meta.name} color={meta.color} badge="任务" badgeClass="bg-violet-50 text-violet-600" extra={`→ ${agentMeta(p.to ?? '').name}`} time={fmtTime(m.createdAt)}>
                {p.summary}
              </Row>
            )
          }
          if (m.topic === 'agent_reply') {
            return (
              <Row key={m.id} name={meta.name} color={meta.color} badge="回执" badgeClass="bg-emerald-50 text-emerald-600" extra="↩ 回执" time={fmtTime(m.createdAt)}>
                {p.summary}
              </Row>
            )
          }
          return (
            <Row key={m.id} name={meta.name} color={meta.color} badge="事件" badgeClass="bg-sky-50 text-sky-600" extra={m.topic} time={fmtTime(m.createdAt)}>
              {payloadText(m.payload)}
            </Row>
          )
        })}

        {local.map((m, i) => {
          const meta = agentMeta(m.from)
          const isUser = m.kind === 'user'
          return (
            <Row
              key={`l${i}`}
              name={meta.name}
              color={meta.color}
              badge={isUser ? '指令' : '队长'}
              badgeClass={isUser ? 'bg-neutral-100 text-neutral-500' : 'bg-indigo-50 text-indigo-600'}
            >
              {m.text}
              {m.applied && m.applied.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.applied.map((a, j) => (
                    <span key={j} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">
                      {a}
                    </span>
                  ))}
                </div>
              )}
            </Row>
          )
        })}
      </div>

      <div className="border-t border-neutral-200 p-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="给队长下令，如：只看不买，别碰 600160"
            className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
          />
          <button
            onClick={send}
            disabled={sending}
            className="shrink-0 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {sending ? '处理中' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({
  name,
  color,
  badge,
  badgeClass,
  extra,
  time,
  children,
}: {
  name: string
  color: string
  badge: string
  badgeClass: string
  extra?: string
  time?: string
  children: ReactNode
}) {
  return (
    <div className="flex gap-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${color}`}>{name[0]}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-neutral-900">{name}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${badgeClass}`}>{badge}</span>
          {extra && <span className="text-xs text-neutral-400">{extra}</span>}
          {time && <span className="ml-auto text-xs text-neutral-400">{time}</span>}
        </div>
        <div className="mt-1 text-sm leading-relaxed text-neutral-600">{children}</div>
      </div>
    </div>
  )
}
