'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { agentMeta } from './agent-meta'
import type { MsgRecord } from './war-room'

// 数据库存的是 UTC（datetime('now')，无时区标记）→ 补 Z 解析再转本地，否则界面会差 8 小时。
const fmtTime = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + 'Z')
  return isNaN(d.getTime()) ? (s.split(' ')[1] ?? s) : d.toLocaleTimeString('zh-CN', { hour12: false })
}

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

export function AgentChat({ accountId, messages }: { accountId: string; messages: MsgRecord[] }) {
  const [local, setLocal] = useState<LocalMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // 拉启用中的成员(队长除外,它是不 @ 时的默认目标)供 @ 下拉用。
  useEffect(() => {
    fetch(`/api/mesh/agents?accountId=${accountId}`)
      .then((r) => r.json())
      .then((d: { agents?: { id: string; role: string; enabled: boolean }[] }) =>
        setAgents((d.agents ?? []).filter((a) => a.enabled && a.role !== 'leader').map((a) => ({ id: a.id, name: agentMeta(a.id).name }))),
      )
      .catch(() => {})
  }, [accountId])

  // 正在输入 @<片段> 时弹成员下拉(@ 直达该成员,绕过队长)。
  const atMatch = input.match(/@(\S*)$/)
  const atOptions = atMatch ? agents.filter((a) => a.id.includes(atMatch[1]) || a.name.includes(atMatch[1])) : []
  const showAtMenu = Boolean(atMatch) && atOptions.length > 0
  const pickAgent = (id: string) => {
    setInput((cur) => cur.replace(/@(\S*)$/, `@${id} `))
    inputRef.current?.focus()
  }

  const send = async () => {
    const msg = input.trim()
    if (!msg || sending) return
    const at = msg.match(/^@(\S+)\s+([\s\S]+)$/)
    const target = at && agents.some((a) => a.id === at[1]) ? at[1] : null
    setInput('')
    setSending(true)
    try {
      if (target) {
        // @ 直达该成员:发定向任务。它的处理 + 回执会经轮询出现在消息流(不本地追加,避免与轮询重复)。
        const r = await fetch('/api/mesh/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: target, text: at![2].trim(), accountId }),
        })
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          setLocal((l) => [...l, { kind: 'command', from: target, text: data.error || '(发送失败)' }])
        }
      } else {
        setLocal((l) => [...l, { kind: 'user', from: 'user', text: msg }])
        const r = await fetch('/api/mesh/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: msg, accountId }),
        })
        const data = await r.json()
        setLocal((l) => [...l, { kind: 'command', from: 'team.leader', text: data.reply || '(无回复)', applied: describeApplied(data.applied) }])
      }
    } catch {
      setLocal((l) => [...l, { kind: 'command', from: target ?? 'team.leader', text: '(处理失败)' }])
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
        <div className="relative flex items-center gap-2">
          {showAtMenu && (
            <div className="absolute bottom-full left-0 mb-1.5 max-h-56 w-64 overflow-y-auto rounded-lg border bg-white shadow-lg">
              <div className="bg-neutral-50 px-3 py-1.5 text-xs text-neutral-400">@ 直达成员（绕过队长）</div>
              {atOptions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pickAgent(a.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                >
                  <span className="font-medium text-neutral-900">{a.name}</span>
                  <span className="truncate font-mono text-xs text-neutral-400">{a.id}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (showAtMenu) pickAgent(atOptions[0].id)
              else send()
            }}
            placeholder="给队长下令；或输入 @ 直接对话某个成员"
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
