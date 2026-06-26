'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { agentMeta } from './agent-meta'
import type { MsgRecord } from './war-room'

// 数据库存的是 UTC（datetime('now')，无时区标记）→ 补 Z 解析再转本地，否则界面会差 8 小时。
const fmtTime = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + 'Z')
  return isNaN(d.getTime()) ? (s.split(' ')[1] ?? s) : d.toLocaleTimeString('zh-CN', { hour12: false })
}
const parseAt = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z') || 0
const fmtMs = (ms: number) => new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })

function payloadText(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('，')
  }
  return String(payload ?? '')
}

/** 本地的「你」消息（@ 直达成员发出 / 发送失败 / 用法提示）；带时间。 */
interface LocalMsg {
  text: string
  at: number
}

/** 轮询来的消息（事件/任务/回执）渲染成一行。 */
function renderMsg(m: MsgRecord): ReactNode {
  const meta = agentMeta(m.from)
  const p = (m.payload ?? {}) as { summary?: string; to?: string }
  const time = fmtTime(m.createdAt)
  if (m.topic === 'agent_task') {
    return (
      <Row key={m.id} name={meta.name} color={meta.color} badge="任务" badgeClass="bg-violet-50 text-violet-600" extra={`→ ${agentMeta(p.to ?? '').name}`} time={time}>
        {p.summary}
      </Row>
    )
  }
  if (m.topic === 'agent_reply') {
    return (
      <Row key={m.id} name={meta.name} color={meta.color} badge="回执" badgeClass="bg-emerald-50 text-emerald-600" extra="↩ 回执" time={time}>
        {p.summary}
      </Row>
    )
  }
  return (
    <Row key={m.id} name={meta.name} color={meta.color} badge="事件" badgeClass="bg-sky-50 text-sky-600" extra={m.topic} time={time}>
      {payloadText(m.payload)}
    </Row>
  )
}

/** 本地「你」消息渲染成一行（带时间）。 */
function renderLocal(m: LocalMsg, key: string): ReactNode {
  const meta = agentMeta('user')
  return (
    <Row key={key} name={meta.name} color={meta.color} badge="你" badgeClass="bg-neutral-100 text-neutral-500" time={fmtMs(m.at)}>
      {m.text}
    </Row>
  )
}

export function AgentChat({ accountId, messages }: { accountId: string; messages: MsgRecord[] }) {
  const [local, setLocal] = useState<LocalMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // 拉启用中的成员（队长是管理锚点、不参与协作，不列入 @ 直达对象）供 @ 下拉用。
  useEffect(() => {
    fetch(`/api/mesh/agents?accountId=${accountId}`)
      .then((r) => r.json())
      .then((d: { agents?: { id: string; role: string; enabled: boolean }[] }) =>
        setAgents((d.agents ?? []).filter((a) => a.enabled && a.role !== 'leader').map((a) => ({ id: a.id, name: agentMeta(a.id).name }))),
      )
      .catch(() => {})
  }, [accountId])

  // 正在输入 @<片段> 时弹成员下拉。
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
    if (!target) {
      // 没 @ 指定成员:这个框只做「@ 直达成员对话」;增删改成员请用「AI 团队管家」。给本地提示,不发后端。
      setLocal((l) => [...l, { text: '请用 @ 指定要对话的成员；增删改成员请用「AI 团队管家」。', at: Date.now() }])
      return
    }
    setInput('')
    setSending(true)
    try {
      // @ 直达该成员:发定向任务。它的处理 + 回执会经轮询出现在消息流(不本地追加,避免与轮询重复)。
      const r = await fetch('/api/mesh/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: target, text: at![2].trim(), accountId }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        setLocal((l) => [...l, { text: `@${target} 发送失败：${data.error || '未知错误'}`, at: Date.now() }])
      }
    } catch {
      setLocal((l) => [...l, { text: `@${target} 发送失败`, at: Date.now() }])
    } finally {
      setSending(false)
    }
  }

  const empty = messages.length === 0 && local.length === 0
  // 轮询消息 + 本地「你」消息统一成一条流，按时间倒排（最新在上）。
  const stream = [
    ...messages.map((m) => ({ at: parseAt(m.createdAt), el: renderMsg(m) })),
    ...local.map((m, i) => ({ at: m.at, el: renderLocal(m, `u${m.at}-${i}`) })),
  ].sort((a, b) => b.at - a.at)

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-900">团队消息流</h2>
        <p className="mt-0.5 text-xs text-neutral-400">事件广播 · 定向任务 · 回执 · 你 @ 成员的对话（最新在上）</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {empty && <div className="py-8 text-center text-sm text-neutral-400">还没有消息 —— 启动团队，或在下方 @ 某个成员对话</div>}
        {stream.map((it) => it.el)}
      </div>

      <div className="border-t border-neutral-200 p-3">
        <div className="relative flex items-center gap-2">
          {showAtMenu && (
            <div className="absolute bottom-full left-0 mb-1.5 max-h-56 w-64 overflow-y-auto rounded-lg border bg-white shadow-lg">
              <div className="bg-neutral-50 px-3 py-1.5 text-xs text-neutral-400">@ 直达成员</div>
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
            placeholder="输入 @ 直接对话某个成员（增删改成员用「AI 团队管家」）"
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
